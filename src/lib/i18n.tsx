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

const STRINGS: Record<LangCode, Record<string, string>> = {
  en: {
    'tab.home': 'Home', 'tab.puzzles': 'Puzzles', 'tab.matches': 'Matches',
    'tab.community': 'Community', 'tab.profile': 'Profile', 'tab.ranks': 'Ranks',

    'auth.tagline': 'Rank your rolls. Climb the ladder.',
    'auth.email': 'Email', 'auth.password': 'Password', 'auth.signIn': 'Sign in',
    'auth.newHere': 'New here?', 'auth.createAccount': 'Create an account',

    'settings.title': 'Settings', 'settings.language': 'Language',
    'settings.languageHint': 'Choose the language the app is shown in.', 'settings.account': 'Account',

    'profile.settings': 'Settings', 'profile.editProfile': 'Edit profile',
    'profile.importComp': 'Import competition record', 'profile.myJuniors': 'My juniors',
    'profile.juniorChallenges': 'Junior challenges', 'profile.signOut': 'Sign out',
    'profile.deleteAccount': 'Delete account',

    'home.startMatch': 'Start a Match', 'home.startMatchSub': 'Challenge someone at the mat',
    'home.yourRating': 'YOUR RATING', 'home.winStreak': 'win streak', 'home.viewRankings': 'View rankings ›',
    'home.yourStats': 'Your Stats', 'home.statRating': 'Rating', 'home.statWins': 'Wins',
    'home.statWinRate': 'Win rate', 'home.statDrawRate': 'Draw rate', 'home.statMatches': 'Matches',
    'home.needsAttention': 'Needs your attention', 'home.recentMatches': 'Recent matches',
    'home.noMatchesTitle': 'No matches yet',
    'home.noMatchesSub': 'Start a challenge at the next open mat to get on the board.',
    'home.viewAll': 'View all matches', 'home.newChallenge': 'New Challenge',

    'lb.title': 'Rankings', 'lb.overall': 'Overall', 'lb.under13': '13 & under',
    'lb.emptyTitle': 'No grapplers here yet', 'lb.emptySub': 'Try a wider level, or be the first to climb.',
    'lb.noGeo': "Set your gym's location to rank at this level. Showing nothing until then.",
    'lb.kidsNote': 'Under-14 athletes ranked by rating. For their privacy, only a first name is shown.',
    'lb.kidsEmptyTitle': 'No ranked juniors here',
    'lb.kidsEmptySub': "Try a wider level, or once they've competed they'll show up.",
    'lb.you': '(you)', 'lb.yours': '(yours)', 'lb.w': 'W', 'lb.l': 'L', 'lb.d': 'D',

    'geo.city': 'City', 'geo.state': 'State', 'geo.country': 'Country',
    'geo.continent': 'Continent', 'geo.world': 'World',

    'matches.filterAll': 'All', 'matches.filterActive': 'Active', 'matches.filterCompleted': 'Completed',
    'matches.emptyTitle': 'Nothing here yet',
    'matches.emptySub': 'Matches you compete in or referee will show up here.',

    'belt.white': 'White', 'belt.blue': 'Blue', 'belt.purple': 'Purple', 'belt.brown': 'Brown', 'belt.black': 'Black',

    'nav.match': 'Match', 'nav.puzzle': 'Puzzle', 'nav.competitionRecord': 'Competition Record',
    'nav.gyms': 'Gyms', 'nav.gym': 'Gym', 'nav.findRoll': 'Find a Roll', 'nav.openMats': 'Open Mats',
    'nav.biggestPots': 'Biggest Pots', 'nav.matchChat': 'Match chat', 'nav.watch': 'Watch',
    'nav.rivalries': 'Rivalries', 'nav.champions': 'Champions', 'nav.notifications': 'Notifications',
    'nav.submissionHunt': 'Submission Hunt', 'nav.quests': 'Quests', 'nav.seasons': 'Seasons',
    'nav.tournaments': 'Tournaments', 'nav.tournament': 'Tournament', 'nav.gymRankings': 'Gym Rankings',

    'onb.welcome': 'Welcome to Roll for Rating', 'onb.intro': "Turn open mats into a ranked ladder. Here's the gist:",
    'onb.step1Title': 'Challenge someone',
    'onb.step1Body': 'Pick an opponent and a referee at the mat — both agree in the app.',
    'onb.step2Title': 'Roll, then the ref records it',
    'onb.step2Body': 'After the roll the referee taps the winner. No claiming your own wins.',
    'onb.step3Title': 'Your rating moves',
    'onb.step3Body': 'Climb tiers, win title belts, settle rivalries, and top the leaderboard.',
    'onb.setup': 'Set yourself up', 'onb.cityLabel': 'Your city / area',
    'onb.cityPlaceholder': 'So nearby rollers can find you', 'onb.openTitle': 'Open for a challenge',
    'onb.openSub': 'Appear in Find a Roll so people can challenge you.',
    'onb.tip': 'Tip: join your academy under Community → Browse gyms to find teammates and rivals.',
    'onb.getStarted': 'Get started', 'onb.skip': 'Skip for now',

    'su.title': 'Create account', 'su.displayName': 'Display name', 'su.username': 'Username',
    'su.passwordPlaceholder': 'At least 6 characters', 'su.beltRank': 'Belt rank', 'su.dob': 'Date of birth',
    'su.kidNoticeTitle': 'A parent needs to set this up',
    'su.kidNoticeBody': 'Under-14 accounts are created and managed by a parent or guardian from their own account. Ask them to sign in (or sign up) and add you under “My juniors”.',
    'su.parentEmail': 'Parent / guardian email',
    'su.teenNote': 'Under 18: we’ll email your parent/guardian a link to approve the account. Once approved you can match anyone and appear on leaderboards — wagering stays adults-only.',
    'su.haveAccount': 'Already have an account?',

    'comm.yourGym': 'YOUR GYM', 'comm.yourGymFallback': 'Your gym',
    'comm.noGymTitle': "You haven't joined a gym yet",
    'comm.noGymSub': 'Join your academy to find teammates and challenge rivals.',
    'comm.findCreateGym': 'Find or create a gym',
    'comm.watchSub': 'Public matches — view counts and reactions',
    'comm.findRollSub': 'Your gym network, or anyone open for a challenge nearby',
    'comm.rankingsSub': 'The global leaderboard',
    'comm.openMatsSub': 'Find and post local open mat sessions',
    'comm.questsSub': 'Weekly challenges + your daily streak',
    'comm.seasonsSub': 'The seasonal points race + champions',
    'comm.tournamentsSub': 'Join events and race for wins',
    'comm.gymRankingsSub': 'Which academy is strongest',
    'comm.submissionHuntSub': 'Collect submissions for bonus Elo',
    'comm.biggestPotsSub': 'High rollers — most Elo won via wagers',
    'comm.browseGyms': 'Browse gyms', 'comm.browseGymsSub': 'Explore academies and switch gyms',

    'pz.intro': 'Test your jiu-jitsu IQ. Correct answers raise your rating; wrong ones cost you.',
    'pz.solved': 'Solved', 'pz.accuracy': 'Accuracy', 'pz.attempts': 'Attempts',
    'pz.chooseMode': 'Choose a mode',
    'pz.mcTitle': 'Multiple choice', 'pz.mcSub': 'Pick the best answer. Instant feedback. Easy mode.',
    'pz.writtenTitle': 'Written answer', 'pz.writtenSub': 'Explain your answer; an AI coach grades it. Hard mode.',
    'pz.noTitle': 'No puzzles yet', 'pz.noSub': 'Add some puzzles to get started.',
    'pz.yourAnswer': 'Your answer', 'pz.answerPlaceholder': 'Explain your answer in a few sentences…',
    'pz.submit': 'Submit for grading', 'pz.correct': 'Correct!', 'pz.notQuite': 'Not quite',
    'pz.practice': 'Practice', 'pz.score': 'Score',
    'pz.lowEffort': 'That answer didn’t really address the question.',
    'pz.modelAnswer': 'Model answer', 'pz.rating': 'Rating', 'pz.next': 'Next puzzle',
  },
  es: {
    'tab.home': 'Inicio', 'tab.puzzles': 'Ejercicios', 'tab.matches': 'Combates',
    'tab.community': 'Comunidad', 'tab.profile': 'Perfil', 'tab.ranks': 'Clasificación',

    'auth.tagline': 'Puntúa tus rolls. Escala en la clasificación.',
    'auth.email': 'Correo electrónico', 'auth.password': 'Contraseña', 'auth.signIn': 'Iniciar sesión',
    'auth.newHere': '¿Nuevo por aquí?', 'auth.createAccount': 'Crear una cuenta',

    'settings.title': 'Ajustes', 'settings.language': 'Idioma',
    'settings.languageHint': 'Elige el idioma en que se muestra la app.', 'settings.account': 'Cuenta',

    'profile.settings': 'Ajustes', 'profile.editProfile': 'Editar perfil',
    'profile.importComp': 'Importar historial de competición', 'profile.myJuniors': 'Mis menores',
    'profile.juniorChallenges': 'Retos de menores', 'profile.signOut': 'Cerrar sesión',
    'profile.deleteAccount': 'Eliminar cuenta',

    'home.startMatch': 'Iniciar un combate', 'home.startMatchSub': 'Reta a alguien en el tatami',
    'home.yourRating': 'TU PUNTUACIÓN', 'home.winStreak': 'racha de victorias', 'home.viewRankings': 'Ver clasificación ›',
    'home.yourStats': 'Tus estadísticas', 'home.statRating': 'Puntuación', 'home.statWins': 'Victorias',
    'home.statWinRate': '% de victorias', 'home.statDrawRate': '% de empates', 'home.statMatches': 'Combates',
    'home.needsAttention': 'Requiere tu atención', 'home.recentMatches': 'Combates recientes',
    'home.noMatchesTitle': 'Aún no hay combates',
    'home.noMatchesSub': 'Lanza un reto en el próximo open mat para entrar en la clasificación.',
    'home.viewAll': 'Ver todos los combates', 'home.newChallenge': 'Nuevo reto',

    'lb.title': 'Clasificación', 'lb.overall': 'General', 'lb.under13': '13 y menores',
    'lb.emptyTitle': 'Aún no hay competidores aquí', 'lb.emptySub': 'Prueba un nivel más amplio o sé el primero en subir.',
    'lb.noGeo': 'Configura la ubicación de tu gimnasio para clasificar en este nivel. No se muestra nada hasta entonces.',
    'lb.kidsNote': 'Atletas menores de 14 años por puntuación. Por su privacidad, solo se muestra el nombre.',
    'lb.kidsEmptyTitle': 'Aún no hay menores clasificados aquí',
    'lb.kidsEmptySub': 'Prueba un nivel más amplio; aparecerán cuando hayan competido.',
    'lb.you': '(tú)', 'lb.yours': '(tuyo)', 'lb.w': 'V', 'lb.l': 'D', 'lb.d': 'E',

    'geo.city': 'Ciudad', 'geo.state': 'Estado', 'geo.country': 'País',
    'geo.continent': 'Continente', 'geo.world': 'Mundo',

    'matches.filterAll': 'Todos', 'matches.filterActive': 'Activos', 'matches.filterCompleted': 'Completados',
    'matches.emptyTitle': 'Aún no hay nada',
    'matches.emptySub': 'Los combates en los que compites o arbitras aparecerán aquí.',

    'belt.white': 'Blanco', 'belt.blue': 'Azul', 'belt.purple': 'Morado', 'belt.brown': 'Marrón', 'belt.black': 'Negro',

    'nav.match': 'Combate', 'nav.puzzle': 'Ejercicio', 'nav.competitionRecord': 'Historial de competición',
    'nav.gyms': 'Gimnasios', 'nav.gym': 'Gimnasio', 'nav.findRoll': 'Buscar combate', 'nav.openMats': 'Open Mats',
    'nav.biggestPots': 'Mayores botes', 'nav.matchChat': 'Chat del combate', 'nav.watch': 'Ver',
    'nav.rivalries': 'Rivalidades', 'nav.champions': 'Campeones', 'nav.notifications': 'Notificaciones',
    'nav.submissionHunt': 'Caza de sumisiones', 'nav.quests': 'Misiones', 'nav.seasons': 'Temporadas',
    'nav.tournaments': 'Torneos', 'nav.tournament': 'Torneo', 'nav.gymRankings': 'Ranking de gimnasios',

    'onb.welcome': 'Bienvenido a Roll for Rating', 'onb.intro': 'Convierte los open mats en una clasificación. La idea:',
    'onb.step1Title': 'Reta a alguien',
    'onb.step1Body': 'Elige un oponente y un árbitro en el tatami: ambos aceptan en la app.',
    'onb.step2Title': 'Rueda y el árbitro lo registra',
    'onb.step2Body': 'Tras el combate el árbitro marca al ganador. No puedes declarar tus propias victorias.',
    'onb.step3Title': 'Tu puntuación cambia',
    'onb.step3Body': 'Sube de nivel, gana títulos, resuelve rivalidades y lidera la clasificación.',
    'onb.setup': 'Configúrate', 'onb.cityLabel': 'Tu ciudad / zona',
    'onb.cityPlaceholder': 'Para que otros cercanos te encuentren', 'onb.openTitle': 'Disponible para un reto',
    'onb.openSub': 'Aparece en Buscar combate para que te reten.',
    'onb.tip': 'Consejo: únete a tu academia en Comunidad → Explorar gimnasios para encontrar compañeros y rivales.',
    'onb.getStarted': 'Empezar', 'onb.skip': 'Omitir por ahora',

    'su.title': 'Crear cuenta', 'su.displayName': 'Nombre visible', 'su.username': 'Nombre de usuario',
    'su.passwordPlaceholder': 'Al menos 6 caracteres', 'su.beltRank': 'Cinturón', 'su.dob': 'Fecha de nacimiento',
    'su.kidNoticeTitle': 'Un padre debe configurarlo',
    'su.kidNoticeBody': 'Las cuentas de menores de 14 las crea y gestiona un padre o tutor desde su propia cuenta. Pídele que inicie sesión (o se registre) y te añada en “Mis menores”.',
    'su.parentEmail': 'Correo del padre/tutor',
    'su.teenNote': 'Menores de 18: enviaremos a tu padre/tutor un enlace para aprobar la cuenta. Tras la aprobación podrás competir con cualquiera y aparecer en clasificaciones; las apuestas son solo para adultos.',
    'su.haveAccount': '¿Ya tienes cuenta?',

    'comm.yourGym': 'TU GIMNASIO', 'comm.yourGymFallback': 'Tu gimnasio',
    'comm.noGymTitle': 'Aún no te has unido a un gimnasio',
    'comm.noGymSub': 'Únete a tu academia para encontrar compañeros y retar rivales.',
    'comm.findCreateGym': 'Buscar o crear un gimnasio',
    'comm.watchSub': 'Combates públicos: vistas y reacciones',
    'comm.findRollSub': 'Tu red del gimnasio, o cualquiera disponible cerca',
    'comm.rankingsSub': 'La clasificación global',
    'comm.openMatsSub': 'Encuentra y publica open mats locales',
    'comm.questsSub': 'Retos semanales + tu racha diaria',
    'comm.seasonsSub': 'La carrera de puntos de temporada + campeones',
    'comm.tournamentsSub': 'Únete a eventos y compite por victorias',
    'comm.gymRankingsSub': 'Qué academia es la más fuerte',
    'comm.submissionHuntSub': 'Colecciona sumisiones para Elo extra',
    'comm.biggestPotsSub': 'High rollers: más Elo ganado en apuestas',
    'comm.browseGyms': 'Explorar gimnasios', 'comm.browseGymsSub': 'Explora academias y cambia de gimnasio',

    'pz.intro': 'Pon a prueba tu IQ de jiu-jitsu. Las respuestas correctas suben tu puntuación; las incorrectas la bajan.',
    'pz.solved': 'Resueltos', 'pz.accuracy': 'Precisión', 'pz.attempts': 'Intentos',
    'pz.chooseMode': 'Elige un modo',
    'pz.mcTitle': 'Opción múltiple', 'pz.mcSub': 'Elige la mejor respuesta. Respuesta al instante. Modo fácil.',
    'pz.writtenTitle': 'Respuesta escrita', 'pz.writtenSub': 'Explica tu respuesta; un entrenador de IA la califica. Modo difícil.',
    'pz.noTitle': 'Aún no hay ejercicios', 'pz.noSub': 'Añade algunos ejercicios para empezar.',
    'pz.yourAnswer': 'Tu respuesta', 'pz.answerPlaceholder': 'Explica tu respuesta en unas frases…',
    'pz.submit': 'Enviar para calificar', 'pz.correct': '¡Correcto!', 'pz.notQuite': 'Casi',
    'pz.practice': 'Práctica', 'pz.score': 'Puntuación',
    'pz.lowEffort': 'Esa respuesta no abordó realmente la pregunta.',
    'pz.modelAnswer': 'Respuesta modelo', 'pz.rating': 'Puntuación', 'pz.next': 'Siguiente ejercicio',
  },
  pt: {
    'tab.home': 'Início', 'tab.puzzles': 'Exercícios', 'tab.matches': 'Lutas',
    'tab.community': 'Comunidade', 'tab.profile': 'Perfil', 'tab.ranks': 'Ranking',

    'auth.tagline': 'Avalie seus rolls. Suba no ranking.',
    'auth.email': 'E-mail', 'auth.password': 'Senha', 'auth.signIn': 'Entrar',
    'auth.newHere': 'Novo por aqui?', 'auth.createAccount': 'Criar uma conta',

    'settings.title': 'Configurações', 'settings.language': 'Idioma',
    'settings.languageHint': 'Escolha o idioma em que o app é exibido.', 'settings.account': 'Conta',

    'profile.settings': 'Configurações', 'profile.editProfile': 'Editar perfil',
    'profile.importComp': 'Importar histórico de competição', 'profile.myJuniors': 'Meus menores',
    'profile.juniorChallenges': 'Desafios de menores', 'profile.signOut': 'Sair',
    'profile.deleteAccount': 'Excluir conta',

    'home.startMatch': 'Iniciar uma luta', 'home.startMatchSub': 'Desafie alguém no tatame',
    'home.yourRating': 'SUA PONTUAÇÃO', 'home.winStreak': 'sequência de vitórias', 'home.viewRankings': 'Ver ranking ›',
    'home.yourStats': 'Suas estatísticas', 'home.statRating': 'Pontuação', 'home.statWins': 'Vitórias',
    'home.statWinRate': '% de vitórias', 'home.statDrawRate': '% de empates', 'home.statMatches': 'Lutas',
    'home.needsAttention': 'Precisa da sua atenção', 'home.recentMatches': 'Lutas recentes',
    'home.noMatchesTitle': 'Ainda sem lutas',
    'home.noMatchesSub': 'Lance um desafio no próximo open mat para entrar no ranking.',
    'home.viewAll': 'Ver todas as lutas', 'home.newChallenge': 'Novo desafio',

    'lb.title': 'Ranking', 'lb.overall': 'Geral', 'lb.under13': '13 e menores',
    'lb.emptyTitle': 'Ainda sem competidores aqui', 'lb.emptySub': 'Tente um nível mais amplo ou seja o primeiro a subir.',
    'lb.noGeo': 'Defina a localização da sua academia para classificar neste nível. Nada é exibido até lá.',
    'lb.kidsNote': 'Atletas menores de 14 anos por pontuação. Para a privacidade deles, mostramos só o primeiro nome.',
    'lb.kidsEmptyTitle': 'Ainda sem menores no ranking aqui',
    'lb.kidsEmptySub': 'Tente um nível mais amplo; eles aparecem depois de competir.',
    'lb.you': '(você)', 'lb.yours': '(seu)', 'lb.w': 'V', 'lb.l': 'D', 'lb.d': 'E',

    'geo.city': 'Cidade', 'geo.state': 'Estado', 'geo.country': 'País',
    'geo.continent': 'Continente', 'geo.world': 'Mundo',

    'matches.filterAll': 'Todas', 'matches.filterActive': 'Ativas', 'matches.filterCompleted': 'Concluídas',
    'matches.emptyTitle': 'Ainda não há nada',
    'matches.emptySub': 'As lutas em que você compete ou arbitra aparecem aqui.',

    'belt.white': 'Branca', 'belt.blue': 'Azul', 'belt.purple': 'Roxa', 'belt.brown': 'Marrom', 'belt.black': 'Preta',

    'nav.match': 'Luta', 'nav.puzzle': 'Exercício', 'nav.competitionRecord': 'Histórico de competição',
    'nav.gyms': 'Academias', 'nav.gym': 'Academia', 'nav.findRoll': 'Encontrar luta', 'nav.openMats': 'Open Mats',
    'nav.biggestPots': 'Maiores apostas', 'nav.matchChat': 'Chat da luta', 'nav.watch': 'Assistir',
    'nav.rivalries': 'Rivalidades', 'nav.champions': 'Campeões', 'nav.notifications': 'Notificações',
    'nav.submissionHunt': 'Caça às finalizações', 'nav.quests': 'Missões', 'nav.seasons': 'Temporadas',
    'nav.tournaments': 'Torneios', 'nav.tournament': 'Torneio', 'nav.gymRankings': 'Ranking de academias',

    'onb.welcome': 'Bem-vindo ao Roll for Rating', 'onb.intro': 'Transforme os open mats num ranking. A ideia:',
    'onb.step1Title': 'Desafie alguém',
    'onb.step1Body': 'Escolha um oponente e um árbitro no tatame — ambos aceitam no app.',
    'onb.step2Title': 'Role e o árbitro registra',
    'onb.step2Body': 'Após a luta o árbitro marca o vencedor. Você não declara as próprias vitórias.',
    'onb.step3Title': 'Sua pontuação muda',
    'onb.step3Body': 'Suba de nível, ganhe títulos, resolva rivalidades e lidere o ranking.',
    'onb.setup': 'Configure-se', 'onb.cityLabel': 'Sua cidade / região',
    'onb.cityPlaceholder': 'Para que pessoas por perto te encontrem', 'onb.openTitle': 'Disponível para um desafio',
    'onb.openSub': 'Apareça em Encontrar luta para que te desafiem.',
    'onb.tip': 'Dica: entre na sua academia em Comunidade → Explorar academias para achar parceiros e rivais.',
    'onb.getStarted': 'Começar', 'onb.skip': 'Pular por agora',

    'su.title': 'Criar conta', 'su.displayName': 'Nome de exibição', 'su.username': 'Nome de usuário',
    'su.passwordPlaceholder': 'Pelo menos 6 caracteres', 'su.beltRank': 'Faixa', 'su.dob': 'Data de nascimento',
    'su.kidNoticeTitle': 'Um responsável precisa configurar',
    'su.kidNoticeBody': 'Contas de menores de 14 são criadas e gerenciadas por um responsável na conta dele. Peça para ele entrar (ou se cadastrar) e te adicionar em “Meus menores”.',
    'su.parentEmail': 'E-mail do responsável',
    'su.teenNote': 'Menores de 18: enviaremos ao seu responsável um link para aprovar a conta. Após a aprovação você pode enfrentar qualquer um e aparecer nos rankings — apostas são só para adultos.',
    'su.haveAccount': 'Já tem conta?',

    'comm.yourGym': 'SUA ACADEMIA', 'comm.yourGymFallback': 'Sua academia',
    'comm.noGymTitle': 'Você ainda não entrou em uma academia',
    'comm.noGymSub': 'Entre na sua academia para achar parceiros e desafiar rivais.',
    'comm.findCreateGym': 'Encontrar ou criar uma academia',
    'comm.watchSub': 'Lutas públicas — visualizações e reações',
    'comm.findRollSub': 'A rede da sua academia, ou alguém disponível por perto',
    'comm.rankingsSub': 'O ranking global',
    'comm.openMatsSub': 'Encontre e publique open mats locais',
    'comm.questsSub': 'Desafios semanais + sua sequência diária',
    'comm.seasonsSub': 'A corrida de pontos da temporada + campeões',
    'comm.tournamentsSub': 'Entre em eventos e dispute vitórias',
    'comm.gymRankingsSub': 'Qual academia é a mais forte',
    'comm.submissionHuntSub': 'Colecione finalizações por Elo bônus',
    'comm.biggestPotsSub': 'High rollers — mais Elo ganho em apostas',
    'comm.browseGyms': 'Explorar academias', 'comm.browseGymsSub': 'Explore academias e troque de academia',

    'pz.intro': 'Teste seu QI de jiu-jitsu. Respostas certas sobem sua pontuação; erradas descem.',
    'pz.solved': 'Resolvidos', 'pz.accuracy': 'Precisão', 'pz.attempts': 'Tentativas',
    'pz.chooseMode': 'Escolha um modo',
    'pz.mcTitle': 'Múltipla escolha', 'pz.mcSub': 'Escolha a melhor resposta. Feedback na hora. Modo fácil.',
    'pz.writtenTitle': 'Resposta escrita', 'pz.writtenSub': 'Explique sua resposta; um treinador de IA avalia. Modo difícil.',
    'pz.noTitle': 'Ainda sem exercícios', 'pz.noSub': 'Adicione alguns exercícios para começar.',
    'pz.yourAnswer': 'Sua resposta', 'pz.answerPlaceholder': 'Explique sua resposta em algumas frases…',
    'pz.submit': 'Enviar para avaliação', 'pz.correct': 'Correto!', 'pz.notQuite': 'Quase',
    'pz.practice': 'Treino', 'pz.score': 'Pontuação',
    'pz.lowEffort': 'Essa resposta não abordou realmente a pergunta.',
    'pz.modelAnswer': 'Resposta modelo', 'pz.rating': 'Pontuação', 'pz.next': 'Próximo exercício',
  },
  fr: {
    'tab.home': 'Accueil', 'tab.puzzles': 'Exercices', 'tab.matches': 'Combats',
    'tab.community': 'Communauté', 'tab.profile': 'Profil', 'tab.ranks': 'Classement',

    'auth.tagline': 'Note tes rolls. Grimpe au classement.',
    'auth.email': 'E-mail', 'auth.password': 'Mot de passe', 'auth.signIn': 'Se connecter',
    'auth.newHere': 'Nouveau ici ?', 'auth.createAccount': 'Créer un compte',

    'settings.title': 'Paramètres', 'settings.language': 'Langue',
    'settings.languageHint': "Choisissez la langue d'affichage de l'application.", 'settings.account': 'Compte',

    'profile.settings': 'Paramètres', 'profile.editProfile': 'Modifier le profil',
    'profile.importComp': "Importer l'historique de compétition", 'profile.myJuniors': 'Mes mineurs',
    'profile.juniorChallenges': 'Défis des mineurs', 'profile.signOut': 'Se déconnecter',
    'profile.deleteAccount': 'Supprimer le compte',

    'home.startMatch': 'Lancer un combat', 'home.startMatchSub': 'Défie quelqu’un sur le tapis',
    'home.yourRating': 'TON CLASSEMENT', 'home.winStreak': 'série de victoires', 'home.viewRankings': 'Voir le classement ›',
    'home.yourStats': 'Tes statistiques', 'home.statRating': 'Classement', 'home.statWins': 'Victoires',
    'home.statWinRate': '% de victoires', 'home.statDrawRate': '% de nuls', 'home.statMatches': 'Combats',
    'home.needsAttention': 'Nécessite ton attention', 'home.recentMatches': 'Combats récents',
    'home.noMatchesTitle': 'Aucun combat pour l’instant',
    'home.noMatchesSub': 'Lance un défi au prochain open mat pour entrer au classement.',
    'home.viewAll': 'Voir tous les combats', 'home.newChallenge': 'Nouveau défi',

    'lb.title': 'Classement', 'lb.overall': 'Général', 'lb.under13': '13 ans et moins',
    'lb.emptyTitle': 'Aucun grappler ici pour l’instant', 'lb.emptySub': 'Essaie un niveau plus large, ou sois le premier à grimper.',
    'lb.noGeo': 'Renseigne la localisation de ta salle pour figurer à ce niveau. Rien ne s’affiche avant.',
    'lb.kidsNote': 'Athlètes de moins de 14 ans par classement. Pour leur vie privée, seul le prénom est affiché.',
    'lb.kidsEmptyTitle': 'Aucun mineur classé ici',
    'lb.kidsEmptySub': 'Essaie un niveau plus large ; ils apparaîtront après avoir combattu.',
    'lb.you': '(toi)', 'lb.yours': '(à toi)', 'lb.w': 'V', 'lb.l': 'D', 'lb.d': 'N',

    'geo.city': 'Ville', 'geo.state': 'État', 'geo.country': 'Pays',
    'geo.continent': 'Continent', 'geo.world': 'Monde',

    'matches.filterAll': 'Tous', 'matches.filterActive': 'Actifs', 'matches.filterCompleted': 'Terminés',
    'matches.emptyTitle': 'Rien ici pour l’instant',
    'matches.emptySub': 'Les combats où tu participes ou arbitres apparaîtront ici.',

    'belt.white': 'Blanche', 'belt.blue': 'Bleue', 'belt.purple': 'Violette', 'belt.brown': 'Marron', 'belt.black': 'Noire',

    'nav.match': 'Combat', 'nav.puzzle': 'Exercice', 'nav.competitionRecord': 'Historique de compétition',
    'nav.gyms': 'Salles', 'nav.gym': 'Salle', 'nav.findRoll': 'Trouver un combat', 'nav.openMats': 'Open Mats',
    'nav.biggestPots': 'Plus gros gains', 'nav.matchChat': 'Chat du combat', 'nav.watch': 'Regarder',
    'nav.rivalries': 'Rivalités', 'nav.champions': 'Champions', 'nav.notifications': 'Notifications',
    'nav.submissionHunt': 'Chasse aux soumissions', 'nav.quests': 'Quêtes', 'nav.seasons': 'Saisons',
    'nav.tournaments': 'Tournois', 'nav.tournament': 'Tournoi', 'nav.gymRankings': 'Classement des salles',

    'onb.welcome': 'Bienvenue sur Roll for Rating', 'onb.intro': 'Transforme les open mats en classement. Le principe :',
    'onb.step1Title': 'Défie quelqu’un',
    'onb.step1Body': 'Choisis un adversaire et un arbitre sur le tapis — les deux acceptent dans l’app.',
    'onb.step2Title': 'Combats, puis l’arbitre l’enregistre',
    'onb.step2Body': 'Après le combat l’arbitre désigne le gagnant. Pas d’auto-déclaration.',
    'onb.step3Title': 'Ton classement évolue',
    'onb.step3Body': 'Monte les paliers, gagne des titres, règle les rivalités et domine le classement.',
    'onb.setup': 'Configure-toi', 'onb.cityLabel': 'Ta ville / région',
    'onb.cityPlaceholder': 'Pour que d’autres près de toi te trouvent', 'onb.openTitle': 'Disponible pour un défi',
    'onb.openSub': 'Apparais dans Trouver un combat pour être défié.',
    'onb.tip': 'Astuce : rejoins ta salle dans Communauté → Parcourir les salles pour trouver partenaires et rivaux.',
    'onb.getStarted': 'Commencer', 'onb.skip': 'Passer pour l’instant',

    'su.title': 'Créer un compte', 'su.displayName': 'Nom affiché', 'su.username': "Nom d'utilisateur",
    'su.passwordPlaceholder': 'Au moins 6 caractères', 'su.beltRank': 'Ceinture', 'su.dob': 'Date de naissance',
    'su.kidNoticeTitle': 'Un parent doit s’en charger',
    'su.kidNoticeBody': 'Les comptes des moins de 14 ans sont créés et gérés par un parent depuis son propre compte. Demande-lui de se connecter (ou s’inscrire) et de t’ajouter dans « Mes mineurs ».',
    'su.parentEmail': 'E-mail du parent/tuteur',
    'su.teenNote': 'Moins de 18 ans : nous enverrons à ton parent/tuteur un lien pour approuver le compte. Une fois approuvé, tu peux affronter tout le monde et apparaître aux classements — les paris restent réservés aux adultes.',
    'su.haveAccount': 'Déjà un compte ?',

    'comm.yourGym': 'TA SALLE', 'comm.yourGymFallback': 'Ta salle',
    'comm.noGymTitle': 'Tu n’as pas encore rejoint de salle',
    'comm.noGymSub': 'Rejoins ta salle pour trouver des partenaires et défier des rivaux.',
    'comm.findCreateGym': 'Trouver ou créer une salle',
    'comm.watchSub': 'Combats publics — vues et réactions',
    'comm.findRollSub': 'Le réseau de ta salle, ou quelqu’un de dispo à proximité',
    'comm.rankingsSub': 'Le classement mondial',
    'comm.openMatsSub': 'Trouve et publie des open mats locaux',
    'comm.questsSub': 'Défis hebdomadaires + ta série quotidienne',
    'comm.seasonsSub': 'La course aux points de la saison + champions',
    'comm.tournamentsSub': 'Rejoins des événements et cours après les victoires',
    'comm.gymRankingsSub': 'Quelle salle est la plus forte',
    'comm.submissionHuntSub': 'Collectionne des soumissions pour de l’Elo bonus',
    'comm.biggestPotsSub': 'High rollers — le plus d’Elo gagné en paris',
    'comm.browseGyms': 'Parcourir les salles', 'comm.browseGymsSub': 'Explore les salles et change de salle',

    'pz.intro': 'Teste ton QI de jiu-jitsu. Les bonnes réponses montent ton classement ; les mauvaises le baissent.',
    'pz.solved': 'Résolus', 'pz.accuracy': 'Précision', 'pz.attempts': 'Tentatives',
    'pz.chooseMode': 'Choisis un mode',
    'pz.mcTitle': 'Choix multiple', 'pz.mcSub': 'Choisis la meilleure réponse. Retour immédiat. Mode facile.',
    'pz.writtenTitle': 'Réponse écrite', 'pz.writtenSub': 'Explique ta réponse ; un coach IA la note. Mode difficile.',
    'pz.noTitle': 'Aucun exercice pour l’instant', 'pz.noSub': 'Ajoute des exercices pour commencer.',
    'pz.yourAnswer': 'Ta réponse', 'pz.answerPlaceholder': 'Explique ta réponse en quelques phrases…',
    'pz.submit': 'Envoyer pour notation', 'pz.correct': 'Correct !', 'pz.notQuite': 'Presque',
    'pz.practice': 'Entraînement', 'pz.score': 'Score',
    'pz.lowEffort': 'Cette réponse ne répondait pas vraiment à la question.',
    'pz.modelAnswer': 'Réponse modèle', 'pz.rating': 'Classement', 'pz.next': 'Exercice suivant',
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
