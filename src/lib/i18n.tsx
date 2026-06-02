import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type LangCode = 'en' | 'es' | 'pt' | 'fr';

export const LANGUAGES: { code: LangCode; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'pt', label: 'Português' },
  { code: 'fr', label: 'Français' },
];

const STORAGE_KEY = 'app_lang';

// Translation dictionary. English is the source of truth / fallback.
// Add keys here and translate; t(key) falls back to English then the key itself.
const STRINGS: Record<LangCode, Record<string, string>> = {
  en: {
    'tab.home': 'Home',
    'tab.puzzles': 'Puzzles',
    'tab.matches': 'Matches',
    'tab.community': 'Community',
    'tab.profile': 'Profile',
    'tab.ranks': 'Ranks',

    'auth.tagline': 'Rank your rolls. Climb the ladder.',
    'auth.email': 'Email',
    'auth.password': 'Password',
    'auth.signIn': 'Sign in',
    'auth.newHere': 'New here?',
    'auth.createAccount': 'Create an account',

    'settings.title': 'Settings',
    'settings.language': 'Language',
    'settings.languageHint': 'Choose the language the app is shown in.',
    'settings.account': 'Account',

    'profile.settings': 'Settings',
    'profile.editProfile': 'Edit profile',
    'profile.importComp': 'Import competition record',
    'profile.myJuniors': 'My juniors',
    'profile.juniorChallenges': 'Junior challenges',
    'profile.signOut': 'Sign out',
    'profile.deleteAccount': 'Delete account',
  },
  es: {
    'tab.home': 'Inicio',
    'tab.puzzles': 'Ejercicios',
    'tab.matches': 'Combates',
    'tab.community': 'Comunidad',
    'tab.profile': 'Perfil',
    'tab.ranks': 'Clasificación',

    'auth.tagline': 'Puntúa tus rolls. Escala en la clasificación.',
    'auth.email': 'Correo electrónico',
    'auth.password': 'Contraseña',
    'auth.signIn': 'Iniciar sesión',
    'auth.newHere': '¿Nuevo por aquí?',
    'auth.createAccount': 'Crear una cuenta',

    'settings.title': 'Ajustes',
    'settings.language': 'Idioma',
    'settings.languageHint': 'Elige el idioma en que se muestra la app.',
    'settings.account': 'Cuenta',

    'profile.settings': 'Ajustes',
    'profile.editProfile': 'Editar perfil',
    'profile.importComp': 'Importar historial de competición',
    'profile.myJuniors': 'Mis menores',
    'profile.juniorChallenges': 'Retos de menores',
    'profile.signOut': 'Cerrar sesión',
    'profile.deleteAccount': 'Eliminar cuenta',
  },
  pt: {
    'tab.home': 'Início',
    'tab.puzzles': 'Exercícios',
    'tab.matches': 'Lutas',
    'tab.community': 'Comunidade',
    'tab.profile': 'Perfil',
    'tab.ranks': 'Ranking',

    'auth.tagline': 'Avalie seus rolls. Suba no ranking.',
    'auth.email': 'E-mail',
    'auth.password': 'Senha',
    'auth.signIn': 'Entrar',
    'auth.newHere': 'Novo por aqui?',
    'auth.createAccount': 'Criar uma conta',

    'settings.title': 'Configurações',
    'settings.language': 'Idioma',
    'settings.languageHint': 'Escolha o idioma em que o app é exibido.',
    'settings.account': 'Conta',

    'profile.settings': 'Configurações',
    'profile.editProfile': 'Editar perfil',
    'profile.importComp': 'Importar histórico de competição',
    'profile.myJuniors': 'Meus menores',
    'profile.juniorChallenges': 'Desafios de menores',
    'profile.signOut': 'Sair',
    'profile.deleteAccount': 'Excluir conta',
  },
  fr: {
    'tab.home': 'Accueil',
    'tab.puzzles': 'Exercices',
    'tab.matches': 'Combats',
    'tab.community': 'Communauté',
    'tab.profile': 'Profil',
    'tab.ranks': 'Classement',

    'auth.tagline': 'Note tes rolls. Grimpe au classement.',
    'auth.email': 'E-mail',
    'auth.password': 'Mot de passe',
    'auth.signIn': 'Se connecter',
    'auth.newHere': 'Nouveau ici ?',
    'auth.createAccount': 'Créer un compte',

    'settings.title': 'Paramètres',
    'settings.language': 'Langue',
    'settings.languageHint': "Choisissez la langue d'affichage de l'application.",
    'settings.account': 'Compte',

    'profile.settings': 'Paramètres',
    'profile.editProfile': 'Modifier le profil',
    'profile.importComp': "Importer l'historique de compétition",
    'profile.myJuniors': 'Mes mineurs',
    'profile.juniorChallenges': 'Défis des mineurs',
    'profile.signOut': 'Se déconnecter',
    'profile.deleteAccount': 'Supprimer le compte',
  },
};

function detectDefault(): LangCode {
  try {
    // Web: use the browser locale as a starting guess. Native falls back to 'en'.
    const nav = typeof navigator !== 'undefined' ? navigator.language : '';
    const code = (nav || '').slice(0, 2).toLowerCase();
    if (code === 'es' || code === 'pt' || code === 'fr') return code;
  } catch {
    // ignore
  }
  return 'en';
}

interface I18nValue {
  lang: LangCode;
  setLang: (code: LangCode) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nValue | undefined>(undefined);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<LangCode>('en');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (saved && saved in STRINGS) setLangState(saved as LangCode);
        else setLangState(detectDefault());
      })
      .catch(() => setLangState(detectDefault()));
  }, []);

  const setLang = useCallback((code: LangCode) => {
    setLangState(code);
    AsyncStorage.setItem(STORAGE_KEY, code).catch(() => {});
  }, []);

  const t = useCallback(
    (key: string) => STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? key,
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useTranslation must be used inside <I18nProvider>');
  return ctx;
}
