import { getSetting, setSetting, SETTING_KEYS } from '$lib/server/appSettings';

// Stored in app_settings next to the birthday channel (moved there from the old single-row
// birthday_settings table by migration 17). Absent keys mean the defaults: off, 9:00.
const DEFAULT_HOUR = 9;

export interface BirthdaySettings {
	enabled: boolean;
	// 0-23, interpreted as Europe/Brussels local time by the scheduler — not UTC, since that's
	// what an admin typing "9" actually means.
	hour: number;
}

export async function getBirthdaySettings(): Promise<BirthdaySettings> {
	const [enabled, hour] = await Promise.all([
		getSetting(SETTING_KEYS.birthdayEnabled),
		getSetting(SETTING_KEYS.birthdayHour)
	]);
	const parsedHour = Number(hour);
	return {
		enabled: enabled === 'true',
		// A malformed value (manual DB edit) falls back to the default rather than never matching.
		hour: hour !== null && Number.isInteger(parsedHour) && parsedHour >= 0 && parsedHour <= 23 ? parsedHour : DEFAULT_HOUR
	};
}

export async function updateBirthdaySettings(settings: BirthdaySettings): Promise<void> {
	await setSetting(SETTING_KEYS.birthdayEnabled, settings.enabled ? 'true' : null);
	await setSetting(SETTING_KEYS.birthdayHour, String(settings.hour));
}
