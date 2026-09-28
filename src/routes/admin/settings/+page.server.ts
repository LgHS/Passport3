import { fail } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { requireAdmin, requireAdminUser } from "$lib/server/auth";
import { getAvatarInfoByEmailHash } from "$lib/server/authentikAdmin";
import { pregenerateAvatars } from "$lib/server/avatars";
import { logAuditEvent } from "$lib/server/auditLog";
import { displayName } from "$lib/types";
import {
  getBirthdaySettings,
  updateBirthdaySettings,
} from "$lib/server/birthdaySettings";
import { refreshMattermostCache } from "$lib/server/mattermost";
import { getSetting, setSetting, SETTING_KEYS } from "$lib/server/appSettings";
import { env } from "$env/dynamic/private";

// Mattermost channel ids are 26 lowercase alphanumerics.
const CHANNEL_ID_RE = /^[a-z0-9]{26}$/;

export const load: PageServerLoad = async ({ locals }) => {
  requireAdmin(locals);
  const [birthdaySettings, birthdayChannel, wishlistChannel, wishlistAnnounce] =
    await Promise.all([
      getBirthdaySettings(),
      getSetting(SETTING_KEYS.birthdayChannel),
      getSetting(SETTING_KEYS.wishlistChannel),
      getSetting(SETTING_KEYS.wishlistAnnounce),
    ]);
  return {
    birthdaySettings,
    mattermostChannels: {
      // The .env value is shown as the current one until a channel is picked here.
      birthday: birthdayChannel ?? env.MATTERMOST_BIRTHDAY_CHANNEL_ID ?? "",
      wishlist: wishlistChannel ?? "",
    },
    wishlistAnnounce: wishlistAnnounce === "true",
  };
};

const INVALID_CHANNEL =
  "Identifiant de canal invalide (26 caractères, minuscules et chiffres).";

export const actions: Actions = {
  // Birthday block: on/off, hour, and the channel they're posted to.
  updateBirthdaySettings: async ({ request, locals }) => {
    const admin = requireAdminUser(locals);

    const formData = await request.formData();
    const enabled = formData.has("enabled");
    const hour = Number(formData.get("hour"));
    const channel = String(formData.get("birthdayChannel") ?? "").trim();

    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      return fail(400, {
        birthdayError: "Heure invalide (0 à 23).",
        enabled,
        hour,
      });
    }
    if (channel && !CHANNEL_ID_RE.test(channel)) {
      return fail(400, { birthdayError: INVALID_CHANNEL, enabled, hour });
    }

    const before = {
      ...(await getBirthdaySettings()),
      channel: await getSetting(SETTING_KEYS.birthdayChannel),
    };
    await updateBirthdaySettings({ enabled, hour });
    await setSetting(SETTING_KEYS.birthdayChannel, channel || null);
    await logAuditEvent(
      { sub: admin.sub, label: displayName(admin) },
      "admin",
      "settings.birthday.update",
      {},
      {
        before,
        after: { enabled, hour, channel: channel || null },
      },
    );

    return { birthdaySuccess: true, enabled, hour };
  },

  // Wishlist block: announce new proposals on Mattermost, and where.
  updateWishlistSettings: async ({ request, locals }) => {
    const admin = requireAdminUser(locals);
    const formData = await request.formData();
    const announce = formData.has("wishlistAnnounce");
    const channel = String(formData.get("wishlistChannel") ?? "").trim();
    if (channel && !CHANNEL_ID_RE.test(channel)) {
      return fail(400, { wishlistError: INVALID_CHANNEL });
    }

    const before = {
      announce: (await getSetting(SETTING_KEYS.wishlistAnnounce)) === "true",
      channel: await getSetting(SETTING_KEYS.wishlistChannel),
    };
    await setSetting(SETTING_KEYS.wishlistAnnounce, announce ? "true" : null);
    await setSetting(SETTING_KEYS.wishlistChannel, channel || null);
    await logAuditEvent(
      { sub: admin.sub, label: displayName(admin) },
      "admin",
      "settings.wishlist.update",
      {},
      {
        before,
        after: { announce, channel: channel || null },
      },
    );
    return { wishlistSaved: true };
  },

  refreshMattermostCache: async ({ locals }) => {
    requireAdmin(locals);
    try {
      await refreshMattermostCache();
    } catch {
      return fail(500, {
        mattermostCacheError:
          "La régénération du cache Mattermost a échoué, réessayez.",
      });
    }
    return { mattermostCacheRefreshed: true };
  },

  pregenerateAvatars: async ({ locals }) => {
    const admin = requireAdminUser(locals);
    let result;
    try {
      result = await pregenerateAvatars(await getAvatarInfoByEmailHash(true));
    } catch {
      return fail(500, {
        avatarsError: "La génération des avatars a échoué, réessayez.",
      });
    }
    if (result.generated > 0) {
      await logAuditEvent(
        { sub: admin.sub, label: displayName(admin) },
        "admin",
        "avatars.pregenerate",
        {},
        {
          generated: result.generated,
        },
      );
    }
    return { avatarsGenerated: result };
  },
};
