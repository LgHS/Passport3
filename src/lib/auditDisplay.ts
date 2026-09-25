import type { AuditSource } from '$lib/server/auditLog';

export const ACTION_LABELS: Record<string, string> = {
	'invitation.create': 'Invitation créée',
	'profile.update': 'Profil modifié',
	'avatar.update': 'Photo de profil modifiée',
	'avatar.delete': 'Photo de profil supprimée',
	'trombinoscope.optin.update': 'Visibilité trombinoscope modifiée',
	'trombinoscope.tag.update': 'Tag trombinoscope modifié',
	'emergencyContacts.update': "Contacts d'urgence modifiés",
	'github.invite': 'Invitation GitHub envoyée',
	'github.disconnect': 'Compte GitHub déconnecté',
	'session.revoke': 'Session révoquée',
	'mfaDevice.delete': 'Appareil MFA supprimé',
	'bankInfo.update': 'Coordonnées bancaires modifiées',
	'badge.regenerate': 'Badge RFID régénéré',
	'wishlist.create': 'Proposition wishlist créée',
	'wishlist.edit': 'Proposition wishlist modifiée',
	'wishlist.delete': 'Proposition wishlist supprimée',
	'wishlist.resolve': 'Statut de la proposition wishlist changé'
};

export function actionLabel(action: string): string {
	return ACTION_LABELS[action] ?? action;
}

export function sourceLabel(source: AuditSource): string {
	return source === 'admin' ? 'Admin' : 'Membre';
}

// --- Detail rendering: before/after actions get a GitHub-style diff (only fields that actually
// changed are highlighted red/green — a same-valued field stays plain, otherwise changing just
// `tag` would also highlight an unrelated, unchanged `tagColor`). Flat-details actions
// (invitation.create has nothing to diff against) just list their fields as-is. ---

export type DetailRow =
	| { kind: 'same'; path: string; value: string }
	| { kind: 'changed'; path: string; before: string; after: string }
	| { kind: 'added'; path: string; after: string }
	| { kind: 'removed'; path: string; before: string };

export function flattenObject(
	obj: Record<string, unknown> | null | undefined,
	prefix = ''
): Map<string, string> {
	const map = new Map<string, string>();
	if (!obj) return map;
	for (const [key, value] of Object.entries(obj)) {
		const path = prefix ? `${prefix}.${key}` : key;
		if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
			for (const [k, v] of flattenObject(value as Record<string, unknown>, path)) map.set(k, v);
		} else {
			map.set(path, String(value));
		}
	}
	return map;
}

function hasBeforeAfterShape(
	details: Record<string, unknown>
): details is { before: Record<string, unknown> | null; after: Record<string, unknown> } {
	return 'before' in details && 'after' in details;
}

export function detailRows(details: Record<string, unknown> | null): DetailRow[] {
	if (!details) return [];

	if (hasBeforeAfterShape(details)) {
		const beforeMap = flattenObject(details.before);
		const afterMap = flattenObject(details.after);
		const paths = [...new Set([...beforeMap.keys(), ...afterMap.keys()])].sort();

		// Only what actually changed — an unchanged field next to it added noise without adding
		// information, since "before" already tells you the field existed.
		return paths.flatMap((path): DetailRow[] => {
			const beforeVal = beforeMap.get(path);
			const afterVal = afterMap.get(path);
			if (beforeVal === undefined) return [{ kind: 'added', path, after: afterVal ?? '' }];
			if (afterVal === undefined) return [{ kind: 'removed', path, before: beforeVal }];
			if (beforeVal === afterVal) return [];
			return [{ kind: 'changed', path, before: beforeVal, after: afterVal }];
		});
	}

	// Flat details (e.g. invitation.create) — nothing to diff against, just show as-is.
	return [...flattenObject(details)].map(([path, value]) => ({ kind: 'same' as const, path, value }));
}
