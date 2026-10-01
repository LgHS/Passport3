import { describe, expect, it } from 'vitest';
import {
	canDeleteItem,
	canEditItem,
	canVote,
	isResolveStatus,
	shouldAnnounceResolution
} from '$lib/wishlistRules';
import type { WishlistStatus } from '$lib/wishlistDisplay';

const AUTHOR = '12';
const OTHER = '34';
const item = (status: WishlistStatus, voteCount = 0) => ({ status, authorSub: AUTHOR, voteCount });
const STATUSES: WishlistStatus[] = ['pending', 'exauce', 'rejete'];

describe('canEditItem', () => {
	it('laisse l’auteur modifier sa proposition ouverte tant que personne n’a voté', () => {
		expect(canEditItem(item('pending', 0), AUTHOR, false)).toBe(true);
	});

	it('refuse à l’auteur dès le premier vote, pour ne pas changer un texte déjà voté', () => {
		expect(canEditItem(item('pending', 1), AUTHOR, false)).toBe(false);
	});

	it('refuse à l’auteur une proposition tranchée', () => {
		expect(canEditItem(item('exauce'), AUTHOR, false)).toBe(false);
		expect(canEditItem(item('rejete'), AUTHOR, false)).toBe(false);
	});

	it('refuse toujours à un autre membre', () => {
		for (const status of STATUSES) expect(canEditItem(item(status), OTHER, false)).toBe(false);
	});

	it('laisse toujours faire un admin, votes ou décision compris', () => {
		for (const status of STATUSES) expect(canEditItem(item(status, 5), OTHER, true)).toBe(true);
	});
});

describe('canDeleteItem', () => {
	it('laisse l’auteur supprimer sa proposition ouverte, même déjà votée', () => {
		expect(canDeleteItem(item('pending', 3), AUTHOR, false)).toBe(true);
	});

	it('refuse à l’auteur une proposition tranchée', () => {
		expect(canDeleteItem(item('exauce'), AUTHOR, false)).toBe(false);
		expect(canDeleteItem(item('rejete'), AUTHOR, false)).toBe(false);
	});

	it('refuse toujours à un autre membre', () => {
		for (const status of STATUSES) expect(canDeleteItem(item(status), OTHER, false)).toBe(false);
	});

	it('laisse toujours faire un admin', () => {
		for (const status of STATUSES) expect(canDeleteItem(item(status), OTHER, true)).toBe(true);
	});
});

describe('canVote', () => {
	it('ouvre le vote tant que la proposition est en attente', () => {
		expect(canVote({ status: 'pending' })).toBe(true);
	});

	it('ferme le vote une fois la proposition tranchée', () => {
		expect(canVote({ status: 'exauce' })).toBe(false);
		expect(canVote({ status: 'rejete' })).toBe(false);
	});
});

describe('isResolveStatus', () => {
	it('accepte exaucée, refusée et le retour en attente', () => {
		for (const status of STATUSES) expect(isResolveStatus(status)).toBe(true);
	});

	it('refuse tout le reste', () => {
		for (const status of ['', 'done', 'PENDING', 'exaucé']) expect(isResolveStatus(status)).toBe(false);
	});
});

describe('shouldAnnounceResolution', () => {
	it('annonce une décision nouvelle', () => {
		expect(shouldAnnounceResolution('pending', 'exauce')).toBe(true);
		expect(shouldAnnounceResolution('pending', 'rejete')).toBe(true);
		expect(shouldAnnounceResolution('exauce', 'rejete')).toBe(true);
	});

	it('n’annonce pas un retour en attente', () => {
		expect(shouldAnnounceResolution('exauce', 'pending')).toBe(false);
	});

	it('n’annonce pas deux fois la même décision', () => {
		expect(shouldAnnounceResolution('exauce', 'exauce')).toBe(false);
		expect(shouldAnnounceResolution('rejete', 'rejete')).toBe(false);
	});
});
