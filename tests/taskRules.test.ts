import { describe, expect, it } from 'vitest';
import {
	actionSource,
	canAssign,
	canDeleteTask,
	canEditTask,
	canFlagBlocked,
	canLeave,
	canProgress,
	canSetLeader,
	deriveStatus,
	isLeader,
	isOnTask,
	isValidLeader,
	isOwnerOrLeader,
	isoDay,
	membership,
	publicTaskUrl,
	sortMembers,
	stepsFor
} from '$lib/taskRules';
import { toTask, type MemberRow, type TaskRow } from '$lib/server/tasks';
import type { Task, TaskMember } from '$lib/taskTypes';

// The cast, by sub. Every permission is a question about one of these six people, so the matrices
// below read as "who may do what" rather than as a pile of booleans.
const AUTHOR = '1';
const LEADER = '2';
const VOLUNTEER = '3';
const IMPOSED = '4';
const STRANGER = '5';
const ADMIN = '9'; // An admin who is none of the above — admin-ness is a flag, not a sub.

const member = (sub: string, over: Partial<TaskMember> = {}): TaskMember => ({
	sub,
	label: `user${sub}`,
	imposed: false,
	isLeader: false,
	...over
});

// A task authored by AUTHOR, led by LEADER, with a volunteer and a member an admin imposed.
function task(over: Partial<Task> = {}): Task {
	return {
		id: 1,
		createdAt: '2026-10-01T10:00:00.000Z',
		authorSub: AUTHOR,
		authorLabel: 'user1',
		createdByAdmin: false,
		priority: 2,
		title: 'Ranger l’atelier',
		description: null,
		dueDate: null,
		status: 'todo',
		startedAt: null,
		blocked: null,
		members: [
			member(LEADER, { isLeader: true }),
			member(VOLUNTEER),
			member(IMPOSED, { imposed: true })
		],
		doneAt: null,
		...over
	};
}

describe('deriveStatus', () => {
	it('est à faire par défaut', () => {
		expect(deriveStatus({ doneAt: null, blocked: null, startedAt: null })).toBe('todo');
	});

	it('est en cours une fois démarrée', () => {
		expect(deriveStatus({ doneAt: null, blocked: null, startedAt: '2026-10-01T10:00:00Z' })).toBe('in_progress');
	});

	it('est bloquée même si elle a été démarrée', () => {
		expect(deriveStatus({ doneAt: null, blocked: { kind: 'internal', note: '' }, startedAt: '2026-10-01T10:00:00Z' })).toBe('blocked');
	});

	it('est faite, ce qui prime sur un blocage et sur un démarrage', () => {
		expect(
			deriveStatus({
				doneAt: '2026-10-02T10:00:00Z',
				blocked: { kind: 'external', note: 'pièce manquante' },
				startedAt: '2026-10-01T10:00:00Z'
			})
		).toBe('done');
	});
});

describe('sortMembers', () => {
	it('met le leader en premier et garde l’ordre d’arrivée des autres', () => {
		const sorted = sortMembers([member('a'), member('b'), member('c', { isLeader: true }), member('d')]);
		expect(sorted.map((m) => m.sub)).toEqual(['c', 'a', 'b', 'd']);
	});

	it('ne modifie pas le tableau reçu', () => {
		const input = [member('a'), member('b', { isLeader: true })];
		sortMembers(input);
		expect(input.map((m) => m.sub)).toEqual(['a', 'b']);
	});

	it('accepte une tâche sans leader', () => {
		expect(sortMembers([member('a'), member('b')]).map((m) => m.sub)).toEqual(['a', 'b']);
	});
});

describe('appartenance', () => {
	it('reconnaît qui est sur la tâche', () => {
		expect(isOnTask(task(), LEADER)).toBe(true);
		expect(isOnTask(task(), VOLUNTEER)).toBe(true);
		expect(isOnTask(task(), IMPOSED)).toBe(true);
		// L'auteur n'est pas forcément dessus : avant la règle du leader par défaut, il ne l'était jamais.
		expect(isOnTask(task({ members: [] }), AUTHOR)).toBe(false);
		expect(isOnTask(task(), STRANGER)).toBe(false);
	});

	it('ne reconnaît qu’un seul leader', () => {
		expect(isLeader(task(), LEADER)).toBe(true);
		expect(isLeader(task(), VOLUNTEER)).toBe(false);
		expect(isLeader(task(), STRANGER)).toBe(false);
	});

	it('rend la ligne d’appartenance, ou rien', () => {
		expect(membership(task(), IMPOSED)?.imposed).toBe(true);
		expect(membership(task(), STRANGER)).toBeUndefined();
	});

	it('traite l’auteur comme le leader pour la gestion de la tâche', () => {
		expect(isOwnerOrLeader(task(), AUTHOR)).toBe(true);
		expect(isOwnerOrLeader(task(), LEADER)).toBe(true);
		expect(isOwnerOrLeader(task(), VOLUNTEER)).toBe(false);
		expect(isOwnerOrLeader(task(), STRANGER)).toBe(false);
	});
});

describe('canEditTask', () => {
	// Le leader mène le travail, l'auteur possède l'énoncé : être leader ne suffit pas à le réécrire.
	it.each([
		['un admin', ADMIN, true, true],
		['l’auteur', AUTHOR, false, true],
		['le leader', LEADER, false, false],
		['un volontaire', VOLUNTEER, false, false],
		['un tiers', STRANGER, false, false]
	])('%s : %s', (_who, sub, admin, expected) => {
		expect(canEditTask(task(), sub, admin)).toBe(expected);
	});
});

describe('canSetLeader', () => {
	// Choisir le leader revient à l'auteur (ou à un admin) : le leader ne se passe pas le rôle
	// lui-même, et un volontaire ne s'en empare pas.
	it.each([
		['un admin', ADMIN, true, true],
		['l’auteur', AUTHOR, false, true],
		['le leader', LEADER, false, false],
		['un volontaire', VOLUNTEER, false, false],
		['un membre imposé', IMPOSED, false, false],
		['un tiers', STRANGER, false, false]
	])('%s : %s', (_who, sub, admin, expected) => {
		expect(canSetLeader(task(), sub, admin)).toBe(expected);
	});
});

describe('isValidLeader', () => {
	it('accepte une personne sur la tâche', () => {
		expect(isValidLeader(task(), VOLUNTEER)).toBe(true);
		expect(isValidLeader(task(), IMPOSED)).toBe(true);
	});

	it('accepte de retirer le leader', () => {
		expect(isValidLeader(task(), null)).toBe(true);
	});

	it('refuse quelqu’un qui n’est pas sur la tâche, même l’auteur', () => {
		expect(isValidLeader(task(), STRANGER)).toBe(false);
		expect(isValidLeader(task({ members: [] }), AUTHOR)).toBe(false);
	});
});

describe('canAssign', () => {
	it.each([
		['un admin', ADMIN, true, true],
		['l’auteur', AUTHOR, false, true],
		['le leader', LEADER, false, true],
		['un volontaire', VOLUNTEER, false, false],
		['un membre imposé', IMPOSED, false, false],
		['un tiers', STRANGER, false, false]
	])('%s : %s', (_who, sub, admin, expected) => {
		expect(canAssign(task(), sub, admin)).toBe(expected);
	});

	it('est la même règle que pour signaler un blocage', () => {
		expect(canFlagBlocked).toBe(canAssign);
	});
});

describe('canDeleteTask', () => {
	it('autorise un admin, l’auteur et le leader sur une tâche créée par un membre', () => {
		expect(canDeleteTask(task(), ADMIN, true)).toBe(true);
		expect(canDeleteTask(task(), AUTHOR, false)).toBe(true);
		expect(canDeleteTask(task(), LEADER, false)).toBe(true);
	});

	it('refuse au leader la suppression d’une tâche créée par un admin', () => {
		const imposedTask = task({ createdByAdmin: true });
		expect(canDeleteTask(imposedTask, LEADER, false)).toBe(false);
		// L'auteur et les admins, eux, gardent la main.
		expect(canDeleteTask(imposedTask, AUTHOR, false)).toBe(true);
		expect(canDeleteTask(imposedTask, ADMIN, true)).toBe(true);
	});

	it('refuse à un volontaire, à un membre imposé et à un tiers', () => {
		expect(canDeleteTask(task(), VOLUNTEER, false)).toBe(false);
		expect(canDeleteTask(task(), IMPOSED, false)).toBe(false);
		expect(canDeleteTask(task(), STRANGER, false)).toBe(false);
	});
});

describe('canProgress', () => {
	it('autorise les admins et toute personne sur la tâche', () => {
		expect(canProgress(task(), ADMIN, true)).toBe(true);
		expect(canProgress(task(), LEADER, false)).toBe(true);
		expect(canProgress(task(), VOLUNTEER, false)).toBe(true);
		expect(canProgress(task(), IMPOSED, false)).toBe(true);
	});

	it('refuse à un tiers, et à un auteur qui n’est pas dessus', () => {
		expect(canProgress(task(), STRANGER, false)).toBe(false);
		expect(canProgress(task({ members: [] }), AUTHOR, false)).toBe(false);
	});
});

describe('canLeave', () => {
	it('laisse partir un volontaire', () => {
		expect(canLeave(task(), VOLUNTEER)).toEqual({ ok: true });
	});

	it('laisse partir le leader, qui reste un volontaire', () => {
		expect(canLeave(task(), LEADER)).toEqual({ ok: true });
	});

	it('retient un membre qu’un admin a assigné', () => {
		expect(canLeave(task(), IMPOSED)).toEqual({ ok: false, reason: 'imposed' });
	});

	it('distingue « pas sur la tâche » de « assigné »', () => {
		expect(canLeave(task(), STRANGER)).toEqual({ ok: false, reason: 'not_on_task' });
	});
});

describe('actionSource', () => {
	it('compte comme action du membre pour l’auteur et pour les gens sur la tâche', () => {
		expect(actionSource(task(), AUTHOR)).toBe('user');
		expect(actionSource(task(), LEADER)).toBe('user');
		expect(actionSource(task(), IMPOSED)).toBe('user');
	});

	it('compte comme action admin pour quelqu’un d’extérieur', () => {
		expect(actionSource(task(), STRANGER)).toBe('admin');
	});
});

describe('stepsFor', () => {
	it('démarre une tâche à faire', () => {
		expect(stepsFor({ status: 'todo', startedAt: null, blocked: null }, 'in_progress')).toEqual(['start']);
	});

	it('remet à faire une tâche démarrée', () => {
		expect(stepsFor({ status: 'in_progress', startedAt: 'x', blocked: null }, 'todo')).toEqual(['unstart']);
	});

	it('ne démarre pas deux fois une tâche déjà démarrée', () => {
		expect(stepsFor({ status: 'in_progress', startedAt: 'x', blocked: null }, 'in_progress')).toEqual([]);
	});

	it('débloque avant de remettre à faire', () => {
		expect(stepsFor({ status: 'blocked', startedAt: 'x', blocked: { kind: 'internal', note: '' } }, 'todo')).toEqual([
			'unblock',
			'unstart'
		]);
	});

	it('rouvre une tâche faite, en gardant son démarrage', () => {
		// `started_at` survit à la réouverture, donc rien à redémarrer.
		expect(stepsFor({ status: 'done', startedAt: 'x', blocked: null }, 'in_progress')).toEqual(['reopen']);
	});

	it('rouvre et démarre une tâche faite sans démarrage enregistré', () => {
		expect(stepsFor({ status: 'done', startedAt: null, blocked: null }, 'in_progress')).toEqual(['reopen', 'start']);
	});

	it('rouvre et dé-démarre pour revenir à faire', () => {
		expect(stepsFor({ status: 'done', startedAt: 'x', blocked: null }, 'todo')).toEqual(['reopen', 'unstart']);
	});

	it('termine en une seule étape, quel que soit l’état de départ', () => {
		expect(stepsFor({ status: 'todo', startedAt: null, blocked: null }, 'done')).toEqual(['done']);
		expect(stepsFor({ status: 'blocked', startedAt: 'x', blocked: { kind: 'external', note: '' } }, 'done')).toEqual(['done']);
	});
});

describe('isoDay', () => {
	it('garde le jour civil local, sans décalage de fuseau', () => {
		// Un DATE arrive à minuit local. toISOString() reculerait d'un jour à l'est de Greenwich.
		expect(isoDay(new Date(2026, 0, 1))).toBe('2026-01-01');
		expect(isoDay(new Date(2026, 11, 31))).toBe('2026-12-31');
	});

	it('complète le mois et le jour sur deux chiffres', () => {
		expect(isoDay(new Date(2026, 8, 5))).toBe('2026-09-05');
	});
});

describe('publicTaskUrl', () => {
	it('construit le lien depuis l’origine de l’URI de redirection', () => {
		expect(publicTaskUrl(12, 'https://passport.lghs.be/auth/callback')).toBe('https://passport.lghs.be/tasks?task=12');
	});

	it('rend null sans configuration', () => {
		expect(publicTaskUrl(12, undefined)).toBeNull();
		expect(publicTaskUrl(12, '')).toBeNull();
	});

	it('rend null sur une URI illisible plutôt que de jeter', () => {
		expect(publicTaskUrl(12, 'pas-une-url')).toBeNull();
	});
});

// --- toTask : le passage des lignes SQL à la tâche, là où les champs dérivés sont produits. ---

const taskRow = (over: Partial<TaskRow> = {}): TaskRow => ({
	id: 7,
	created_at: new Date('2026-10-01T08:00:00Z'),
	author_sub: AUTHOR,
	author_label: 'user1',
	created_by_admin: false,
	priority: 2,
	title: 'Ranger l’atelier',
	description: null,
	due_date: null,
	done_at: null,
	started_at: null,
	blocked_kind: null,
	blocked_note: null,
	...over
});

const memberRow = (over: Partial<MemberRow> = {}): MemberRow => ({
	task_id: 7,
	member_sub: VOLUNTEER,
	member_label: 'user3',
	assigned_by_sub: null,
	is_leader: false,
	...over
});

describe('toTask', () => {
	it('déduit le statut des colonnes', () => {
		expect(toTask(taskRow(), []).status).toBe('todo');
		expect(toTask(taskRow({ started_at: new Date() }), []).status).toBe('in_progress');
		expect(toTask(taskRow({ blocked_kind: 'internal' }), []).status).toBe('blocked');
		expect(toTask(taskRow({ done_at: new Date() }), []).status).toBe('done');
	});

	it('marque comme imposé un membre porteur de qui l’a assigné', () => {
		const t = toTask(taskRow(), [
			memberRow({ member_sub: VOLUNTEER, assigned_by_sub: null }),
			memberRow({ member_sub: IMPOSED, assigned_by_sub: ADMIN })
		]);
		expect(t.members.find((m) => m.sub === VOLUNTEER)?.imposed).toBe(false);
		expect(t.members.find((m) => m.sub === IMPOSED)?.imposed).toBe(true);
	});

	it('remonte le leader en tête', () => {
		const t = toTask(taskRow(), [
			memberRow({ member_sub: VOLUNTEER }),
			memberRow({ member_sub: LEADER, is_leader: true })
		]);
		expect(t.members[0].sub).toBe(LEADER);
	});

	it('réduit la date limite à son jour civil', () => {
		expect(toTask(taskRow({ due_date: new Date(2026, 9, 15) }), []).dueDate).toBe('2026-10-15');
	});

	it('rend un blocage sans note comme une note vide, pas comme null', () => {
		const t = toTask(taskRow({ blocked_kind: 'external', blocked_note: null }), []);
		expect(t.blocked).toEqual({ kind: 'external', note: '' });
	});

	it('n’invente pas de blocage quand seule la note est là', () => {
		// blocked_kind est la colonne qui décide ; une note orpheline ne bloque rien.
		expect(toTask(taskRow({ blocked_note: 'bruit' }), []).blocked).toBeNull();
	});
});

// --- La règle ajoutée : le créateur mène sa tâche, sauf si un admin l'a créée. createTask() écrit
// en base, donc ce qui est vérifiable ici est la forme produite et ce qu'elle implique. ---

describe('créateur leader par défaut', () => {
	// Ce que createTask() écrit pour un membre : l'auteur, volontaire et leader.
	const byMember = toTask(taskRow({ author_sub: AUTHOR, created_by_admin: false }), [
		memberRow({ member_sub: AUTHOR, member_label: 'user1', assigned_by_sub: null, is_leader: true })
	]);
	// Ce qu'il écrit pour un admin : rien du tout.
	const byAdmin = toTask(taskRow({ author_sub: ADMIN, created_by_admin: true }), []);

	it('fait du créateur un leader volontaire, pas un membre imposé', () => {
		expect(byMember.members).toHaveLength(1);
		expect(byMember.members[0]).toMatchObject({ sub: AUTHOR, isLeader: true, imposed: false });
	});

	it('lui donne la main sur sa tâche sans être admin', () => {
		expect(canAssign(byMember, AUTHOR, false)).toBe(true);
		expect(canDeleteTask(byMember, AUTHOR, false)).toBe(true);
		expect(canProgress(byMember, AUTHOR, false)).toBe(true);
	});

	it('le laisse quitter sa propre tâche, ce qui la laisse sans leader', () => {
		expect(canLeave(byMember, AUTHOR)).toEqual({ ok: true });
		// Son départ supprime la ligne, et le drapeau de leader avec elle.
		const afterLeaving = toTask(taskRow(), []);
		expect(afterLeaving.members).toHaveLength(0);
		expect(isLeader(afterLeaving, AUTHOR)).toBe(false);
	});

	it('ne met personne sur une tâche créée par un admin', () => {
		expect(byAdmin.members).toHaveLength(0);
		expect(isLeader(byAdmin, ADMIN)).toBe(false);
	});

	it('laisse malgré tout l’admin auteur gérer la tâche qu’il a créée', () => {
		// Via authorSub, sans appartenance : isOwnerOrLeader couvre déjà ce cas.
		expect(canAssign(byAdmin, ADMIN, false)).toBe(true);
		expect(canDeleteTask(byAdmin, ADMIN, false)).toBe(true);
	});

	it('n’autorise pas un tiers à s’en saisir', () => {
		expect(canAssign(byMember, STRANGER, false)).toBe(false);
		expect(canDeleteTask(byAdmin, STRANGER, false)).toBe(false);
	});
});
