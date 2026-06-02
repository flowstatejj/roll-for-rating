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

    'home.startMatch': 'Start a Match',
    'home.startMatchSub': 'Challenge someone at the mat',
    'home.yourRating': 'YOUR RATING',
    'home.winStreak': 'win streak',
    'home.viewRankings': 'View rankings ›',
    'home.yourStats': 'Your Stats',
    'home.statRating': 'Rating',
    'home.statWins': 'Wins',
    'home.statWinRate': 'Win rate',
    'home.statDrawRate': 'Draw rate',
    'home.statMatches': 'Matches',
    'home.needsAttention': 'Needs your attention',
    'home.recentMatches': 'Recent matches',
    'home.noMatchesTitle': 'No matches yet',
    'home.noMatchesSub': 'Start a challenge at the next open mat to get on the board.',
    'home.viewAll': 'View all matches',
    'home.newChallenge': 'New Challenge',

    'lb.title': 'Rankings',
    'lb.overall': 'Overall',
    'lb.under13': '13 & under',
    'lb.emptyTitle': 'No grapplers here yet',
    'lb.emptySub': 'Try a wider level, or be the first to climb.',
    'lb.noGeo': "Set your gym's location to rank at this level. Showing nothing until then.",
    'lb.kidsNote': 'Under-14 athletes ranked by rating. For their privacy, only a first name is shown.',
    'lb.kidsEmptyTitle': 'No ranked juniors here',
    'lb.kidsEmptySub': "Try a wider level, or once they've competed they'll show up.",
    'lb.you': '(you)',
    'lb.yours': '(yours)',
    'lb.w': 'W',
    'lb.l': 'L',
    'lb.d': 'D',

    'geo.city': 'City',
    'geo.state': 'State',
    'geo.country': 'Country',
    'geo.continent': 'Continent',
    'geo.world': 'World',

    'matches.filterAll': 'All',
    'matches.filterActive': 'Active',
    'matches.filterCompleted': 'Completed',
    'matches.emptyTitle': 'Nothing here yet',
    'matches.emptySub': 'Matches you compete in or referee will show up here.',
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

    'home.startMatch': 'Iniciar un combate',
    'home.startMatchSub': 'Reta a alguien en el tatami',
    'home.yourRating': 'TU PUNTUACIÓN',
    'home.winStreak': 'racha de victorias',
    'home.viewRankings': 'Ver clasificación ›',
    'home.yourStats': 'Tus estadísticas',
    'home.statRating': 'Puntuación',
    'home.statWins': 'Victorias',
    'home.statWinRate': '% de victorias',
    'home.statDrawRate': '% de empates',
    'home.statMatches': 'Combates',
    'home.needsAttention': 'Requiere tu atención',
    'home.recentMatches': 'Combates recientes',
    'home.noMatchesTitle': 'Aún no hay combates',
    'home.noMatchesSub': 'Lanza un reto en el próximo open mat para entrar en la clasificación.',
    'home.viewAll': 'Ver todos los combates',
    'home.newChallenge': 'Nuevo reto',

    'lb.title': 'Clasificación',
    'lb.overall': 'General',
    'lb.under13': '13 y menores',
    'lb.emptyTitle': 'Aún no hay competidores aquí',
    'lb.emptySub': 'Prueba un nivel más amplio o sé el primero en subir.',
    'lb.noGeo': 'Configura la ubicación de tu gimnasio para clasificar en este nivel. No se muestra nada hasta entonces.',
    'lb.kidsNote': 'Atletas menores de 14 años por puntuación. Por su privacidad, solo se muestra el nombre.',
    'lb.kidsEmptyTitle': 'Aún no hay menores clasificados aquí',
    'lb.kidsEmptySub': 'Prueba un nivel más amplio; aparecerán cuando hayan competido.',
    'lb.you': '(tú)',
    'lb.yours': '(tuyo)',
    'lb.w': 'V',
    'lb.l': 'D',
    'lb.d': 'E',

    'geo.city': 'Ciudad',
    'geo.state': 'Estado',
    'geo.country': 'País',
    'geo.continent': 'Continente',
    'geo.world': 'Mundo',

    'matches.filterAll': 'Todos',
    'matches.filterActive': 'Activos',
    'matches.filterCompleted': 'Completados',
    'matches.emptyTitle': 'Aún no hay nada',
    'matches.emptySub': 'Los combates en los que compites o arbitras aparecerán aquí.',
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

    'home.startMatch': 'Iniciar uma luta',
    'home.startMatchSub': 'Desafie alguém no tatame',
    'home.yourRating': 'SUA PONTUAÇÃO',
    'home.winStreak': 'sequência de vitórias',
    'home.viewRankings': 'Ver ranking ›',
    'home.yourStats': 'Suas estatísticas',
    'home.statRating': 'Pontuação',
    'home.statWins': 'Vitórias',
    'home.statWinRate': '% de vitórias',
    'home.statDrawRate': '% de empates',
    'home.statMatches': 'Lutas',
    'home.needsAttention': 'Precisa da sua atenção',
    'home.recentMatches': 'Lutas recentes',
    'home.noMatchesTitle': 'Ainda sem lutas',
    'home.noMatchesSub': 'Lance um desafio no próximo open mat para entrar no ranking.',
    'home.viewAll': 'Ver todas as lutas',
    'home.newChallenge': 'Novo desafio',

    'lb.title': 'Ranking',
    'lb.overall': 'Geral',
    'lb.under13': '13 e menores',
    'lb.emptyTitle': 'Ainda sem competidores aqui',
    'lb.emptySub': 'Tente um nível mais amplo ou seja o primeiro a subir.',
    'lb.noGeo': 'Defina a localização da sua academia para classificar neste nível. Nada é exibido até lá.',
    'lb.kidsNote': 'Atletas menores de 14 anos por pontuação. Para a privacidade deles, mostramos só o primeiro nome.',
    'lb.kidsEmptyTitle': 'Ainda sem menores no ranking aqui',
    'lb.kidsEmptySub': 'Tente um nível mais amplo; eles aparecem depois de competir.',
    'lb.you': '(você)',
    'lb.yours': '(seu)',
    'lb.w': 'V',
    'lb.l': 'D',
    'lb.d': 'E',

    'geo.city': 'Cidade',
    'geo.state': 'Estado',
    'geo.country': 'País',
    'geo.continent': 'Continente',
    'geo.world': 'Mundo',

    'matches.filterAll': 'Todas',
    'matches.filterActive': 'Ativas',
    'matches.filterCompleted': 'Concluídas',
    'matches.emptyTitle': 'Ainda não há nada',
    'matches.emptySub': 'As lutas em que você compete ou arbitra aparecem aqui.',
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

    'home.startMatch': 'Lancer un combat',
    'home.startMatchSub': 'Défie quelqu’un sur le tapis',
    'home.yourRating': 'TON CLASSEMENT',
    'home.winStreak': 'série de victoires',
    'home.viewRankings': 'Voir le classement ›',
    'home.yourStats': 'Tes statistiques',
    'home.statRating': 'Classement',
    'home.statWins': 'Victoires',
    'home.statWinRate': '% de victoires',
    'home.statDrawRate': '% de nuls',
    'home.statMatches': 'Combats',
    'home.needsAttention': 'Nécessite ton attention',
    'home.recentMatches': 'Combats récents',
    'home.noMatchesTitle': 'Aucun combat pour l’instant',
    'home.noMatchesSub': 'Lance un défi au prochain open mat pour entrer au classement.',
    'home.viewAll': 'Voir tous les combats',
    'home.newChallenge': 'Nouveau défi',

    'lb.title': 'Classement',
    'lb.overall': 'Général',
    'lb.under13': '13 ans et moins',
    'lb.emptyTitle': 'Aucun grappler ici pour l’instant',
    'lb.emptySub': 'Essaie un niveau plus large, ou sois le premier à grimper.',
    'lb.noGeo': 'Renseigne la localisation de ta salle pour figurer à ce niveau. Rien ne s’affiche avant.',
    'lb.kidsNote': 'Athlètes de moins de 14 ans par classement. Pour leur vie privée, seul le prénom est affiché.',
    'lb.kidsEmptyTitle': 'Aucun mineur classé ici',
    'lb.kidsEmptySub': 'Essaie un niveau plus large ; ils apparaîtront après avoir combattu.',
    'lb.you': '(toi)',
    'lb.yours': '(à toi)',
    'lb.w': 'V',
    'lb.l': 'D',
    'lb.d': 'N',

    'geo.city': 'Ville',
    'geo.state': 'État',
    'geo.country': 'Pays',
    'geo.continent': 'Continent',
    'geo.world': 'Monde',

    'matches.filterAll': 'Tous',
    'matches.filterActive': 'Actifs',
    'matches.filterCompleted': 'Terminés',
    'matches.emptyTitle': 'Rien ici pour l’instant',
    'matches.emptySub': 'Les combats où tu participes ou arbitres apparaîtront ici.',
  },
};

function detectDefault(): LangCode {
  try {
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

  const t = useCallback((key: string) => STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? key, [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useTranslation must be used inside <I18nProvider>');
  return ctx;
}
