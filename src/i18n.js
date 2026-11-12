// -----------------------------------------------------------------------------
// The texts of the connection status and of the test button. Every text is a
// { en, fr } object: Gladys picks the user's language (a plain string is
// refused by setConnectionStatus). Never a raw answer.
// -----------------------------------------------------------------------------

import { CALENDAR_TIMEZONE } from './constants.js';

const formatters = {
  en: new Intl.DateTimeFormat('en-GB', {
    timeZone: CALENDAR_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }),
  fr: new Intl.DateTimeFormat('fr-FR', {
    timeZone: CALENDAR_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }),
};

/** A wall-clock instant in German time, per language. */
export const at = (t, lang = 'en') => {
  if (!Number.isFinite(t)) {
    return '?';
  }
  const text = formatters[lang].format(new Date(t));
  return lang === 'fr' ? `${text} (heure de Berlin)` : `${text} (Berlin time)`;
};

const both = (make) => ({ en: make('en'), fr: make('fr') });

const CONFIG_ERRORS = {
  zip_missing: {
    en: 'Enter the German postcode to follow',
    fr: 'Saisissez le code postal allemand à suivre',
  },
  zip_invalid: {
    en: 'The postcode must be a German postcode of five digits',
    fr: 'Le code postal doit être un code postal allemand de cinq chiffres',
  },
};

// Problems, without any value from the user or the answer but a status code.
const problem = (error, lang) => (typeof error === 'object' ? error[lang] : error);

export const T = {
  configError: (code) =>
    CONFIG_ERRORS[code] ?? { en: 'Invalid configuration', fr: 'Configuration invalide' },
  configUnreadable: {
    en: 'Cannot read the configuration from Gladys, retrying',
    fr: 'Impossible de lire la configuration depuis Gladys, nouvel essai',
  },
  dataUnreadable: {
    en: 'The /data folder cannot be read: retrying every 10 s, nothing is read meanwhile',
    fr: 'Le dossier /data ne peut être lu : nouvel essai toutes les 10 s, aucune lecture d’ici là',
  },
  dataUnwritable: {
    en: 'The /data folder cannot be written: the read waits (fair use)',
    fr: 'Le dossier /data ne peut être écrit : la lecture attend (usage raisonnable)',
  },
  waiting: (next) => ({
    en: `Waiting for the first read, allowed by the fair-use policy at ${at(next, 'en')}`,
    fr: `En attente de la première lecture, permise par l’usage raisonnable à ${at(next, 'fr')}`,
  }),
  noForecast: (zip, next) => ({
    en: `Corrently gave no forecast for ${zip} (check the postcode); next read at ${at(next, 'en')}`,
    fr: `Corrently n’a donné aucune prévision pour ${zip} (vérifiez le code postal) ; prochaine lecture à ${at(next, 'fr')}`,
  }),
  failed: (error, next) => ({
    en: `Reading the GrünstromIndex failed (${problem(error, 'en')}); next read at ${at(next, 'en')}`,
    fr: `La lecture du GrünstromIndex a échoué (${problem(error, 'fr')}) ; prochaine lecture à ${at(next, 'fr')}`,
  }),
  ok: ({ zip, current, fetchedAt, error }) => ({
    en:
      `GrünstromIndex ${zip}: ${current} now (forecast computed ${at(fetchedAt, 'en')})` +
      (error ? `. Last problem: ${problem(error, 'en')}` : ''),
    fr:
      `GrünstromIndex ${zip} : ${current} maintenant (prévision calculée le ${at(fetchedAt, 'fr')})` +
      (error ? `. Dernier problème : ${problem(error, 'fr')}` : ''),
  }),
  report: ({ zip, snap, fetchedAt, error, nextRead }) =>
    both((lang) => {
      const fr = lang === 'fr';
      const unknown = fr ? 'inconnu' : 'unknown';
      const lines = [];
      if (fetchedAt === undefined) {
        lines.push(fr ? `Pas encore de prévision pour ${zip}.` : `No forecast for ${zip} yet.`);
      } else {
        lines.push(
          fr
            ? `GrünstromIndex ${zip}, prévision calculée le ${at(fetchedAt, lang)}.`
            : `GrünstromIndex ${zip}, forecast computed ${at(fetchedAt, lang)}.`,
        );
        lines.push(
          fr
            ? `Maintenant : ${snap.current ?? unknown}, heure suivante : ${snap.next ?? unknown}.`
            : `Now: ${snap.current ?? unknown}, next hour: ${snap.next ?? unknown}.`,
        );
        if (snap.best !== undefined) {
          lines.push(
            fr
              ? `Le plus vert des 24 prochaines heures : ${snap.best}, dans ${snap.hoursToBest} h.`
              : `Greenest of the next 24 h: ${snap.best}, in ${snap.hoursToBest} h.`,
          );
        }
      }
      if (error) {
        lines.push(
          fr
            ? `Dernier problème : ${problem(error, lang)}.`
            : `Last problem: ${problem(error, lang)}.`,
        );
      }
      lines.push(
        fr
          ? `Prochaine lecture (une par heure au plus) : ${at(nextRead, lang)}.`
          : `Next read (one per hour at most): ${at(nextRead, lang)}.`,
      );
      return lines.join(' ');
    }),
};
