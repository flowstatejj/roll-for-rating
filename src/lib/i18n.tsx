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
    'common.cancel': 'Cancel', 'common.ok': 'OK',

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

    'result.submission': 'Submission', 'result.points': 'Points', 'result.advantage': 'Advantage',
    'result.decision': "Referee's decision", 'result.draw': 'Draw',

    'mn.intro': "Pick who you're rolling against and who's refereeing. Both must accept/record for ratings to count.",
    'mn.competingAs': 'Competing as', 'mn.you': 'You',
    'mn.juniorNote': 'No wager, not public, the opponent must be under 18, and the referee must be a blue belt or higher who isn’t either kid’s parent.',
    'mn.opponent': 'Opponent', 'mn.referee': 'Referee', 'mn.tapToChoose': 'Tap to choose',
    'mn.searchOpponent': 'Search for an opponent', 'mn.searchReferee': 'Search for a referee',
    'mn.searchPlaceholder': 'Name or @username', 'mn.noMatches': 'No matching grapplers.',
    'mn.wagerLabel': 'Wager (optional)', 'mn.wagerPlaceholder': 'Extra Elo staked — winner takes it',
    'mn.allIn': 'All-in', 'mn.none': 'None',
    'mn.wagerExplain': 'On a decisive result the winner takes the wagered rating from the loser, on top of normal Elo. Accepting the challenge means agreeing to the wager.',
    'mn.publishTitle': 'Publish publicly',
    'mn.publishSub': 'If both fighters agree, the match shows in Watch for everyone to view & react.',
    'mn.pendingConsent': 'Your account is waiting for a parent/guardian to approve it. You can set up a match once it’s approved.',
    'mn.send': 'Send challenge', 'mn.pickBothTitle': 'Pick both',
    'mn.pickBothBody': 'Choose an opponent and a referee first.', 'mn.createFail': 'Could not create match',

    'md.statusPendingOpponent': 'Awaiting opponent', 'md.statusPendingReferee': 'Awaiting referee',
    'md.statusCompleted': 'Completed', 'md.statusDeclined': 'Declined', 'md.statusCancelled': 'Cancelled',
    'md.wageredSuffix': 'Elo wagered — winner takes it', 'md.wonPot': 'won the {n} Elo pot!',
    'md.stakes': 'STAKES', 'md.wageredWord': 'wagered', 'md.win': 'Win', 'md.lose': 'Lose',
    'md.challenger': 'Challenger', 'md.opponent': 'Opponent', 'md.winnerTag': 'Winner', 'md.you': '(you)',
    'md.referee': 'REFEREE', 'md.whenWhere': 'WHEN & WHERE', 'md.message': 'Message participants',
    'md.public': 'PUBLIC', 'md.view': 'view', 'md.views': 'views',
    'md.willAppear': 'This match will appear in Watch once the referee records the result.',
    'md.result': 'RESULT', 'md.draw': 'Draw', 'md.won': 'won', 'md.by': 'By',
    'md.accept': 'Accept challenge', 'md.decline': 'Decline', 'md.waitingAccept': 'Waiting for {name} to accept…',
    'md.recordResult': 'Record the result', 'md.whoWon': 'Who won by submission?',
    'md.drawChoice': 'Draw — no submission',
    'md.drawWarn': 'A draw deducts rating from BOTH players — same as a loss.',
    'md.finishLabel': "Finish (counts toward the winner's Submission Hunt)",
    'md.notes': 'Notes (optional)', 'md.notesPlaceholder': 'Anything notable about the roll',
    'md.submitResult': 'Submit result',
    'md.waitingRef': 'Both accepted. Waiting for {name} to record the result.',
    'md.cancel': 'Cancel match', 'md.done': 'Done',
    'md.resultRecorded': 'Result recorded and ratings updated.', 'md.error': 'Error',
    'md.incomplete': 'Incomplete', 'md.pickWinner': 'Pick the winner, or mark it a draw.',
    'md.acceptWagerTitle': 'Accept the wager?',
    'md.acceptWagerBody': "You're staking {n} Elo. Win and you take it; lose and it's gone.",
    'md.acceptBtn': 'Accept', 'md.tryAgain': 'Try again.',

    'gd.member': 'member', 'gd.members': 'members', 'gd.leave': 'Leave this gym', 'gd.join': 'Join this gym',
    'gd.welcome': 'Welcome to {name}!', 'gd.requestFriend': 'Request gym friendship',
    'gd.requestSent': 'Request sent to the gym owner.', 'gd.gymFriends': 'Gym friends',
    'gd.noFriends': 'No gym friendships yet.', 'gd.friends': 'Friends', 'gd.wantsConnect': 'Wants to connect',
    'gd.reqSent': 'Request sent', 'gd.membersTitle': 'Members', 'gd.noMembers': 'No members yet.',
    'gd.ownerSuffix': 'owner',

    'gym.create': 'Create a gym', 'gym.name': 'Gym name', 'gym.city': 'City', 'gym.state': 'State / region',
    'gym.country': 'Country', 'gym.locationHint': 'Location powers the City / State / Country / Continent / World leaderboards.',
    'gym.descOptional': 'Description (optional)', 'gym.createBtn': 'Create gym', 'gym.createNew': 'Create a new gym',
    'gym.search': 'Search gyms', 'gym.searchPlaceholder': 'Name or city', 'gym.yourGymSuffix': 'your gym',
    'gym.none': 'No gyms found. Create the first one!', 'gym.nameReqTitle': 'Name required',
    'gym.nameReqBody': 'Give your gym a name.', 'gym.createFail': 'Could not create gym',
  },
  es: {
    'tab.home': 'Inicio', 'tab.puzzles': 'Ejercicios', 'tab.matches': 'Combates',
    'tab.community': 'Comunidad', 'tab.profile': 'Perfil', 'tab.ranks': 'Clasificación',

    'auth.tagline': 'Puntúa tus rolls. Escala en la clasificación.',
    'auth.email': 'Correo electrónico', 'auth.password': 'Contraseña', 'auth.signIn': 'Iniciar sesión',
    'auth.newHere': '¿Nuevo por aquí?', 'auth.createAccount': 'Crear una cuenta',

    'settings.title': 'Ajustes', 'settings.language': 'Idioma',
    'settings.languageHint': 'Elige el idioma en que se muestra la app.', 'settings.account': 'Cuenta',
    'common.cancel': 'Cancelar', 'common.ok': 'OK',

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

    'result.submission': 'Sumisión', 'result.points': 'Puntos', 'result.advantage': 'Ventaja',
    'result.decision': 'Decisión del árbitro', 'result.draw': 'Empate',

    'mn.intro': 'Elige contra quién ruedas y quién arbitra. Ambos deben aceptar/registrar para que cuente.',
    'mn.competingAs': 'Compite como', 'mn.you': 'Tú',
    'mn.juniorNote': 'Sin apuesta, no público, el oponente debe ser menor de 18 y el árbitro debe ser cinturón azul o superior y no ser el padre de ninguno.',
    'mn.opponent': 'Oponente', 'mn.referee': 'Árbitro', 'mn.tapToChoose': 'Toca para elegir',
    'mn.searchOpponent': 'Buscar un oponente', 'mn.searchReferee': 'Buscar un árbitro',
    'mn.searchPlaceholder': 'Nombre o @usuario', 'mn.noMatches': 'No hay competidores que coincidan.',
    'mn.wagerLabel': 'Apuesta (opcional)', 'mn.wagerPlaceholder': 'Elo extra en juego: el ganador se lo lleva',
    'mn.allIn': 'Todo', 'mn.none': 'Ninguna',
    'mn.wagerExplain': 'En un resultado decisivo el ganador se lleva el Elo apostado del perdedor, además del Elo normal. Aceptar el reto implica aceptar la apuesta.',
    'mn.publishTitle': 'Publicar públicamente',
    'mn.publishSub': 'Si ambos aceptan, el combate aparece en Ver para que todos lo vean y reaccionen.',
    'mn.pendingConsent': 'Tu cuenta espera la aprobación de un padre/tutor. Podrás crear un combate cuando esté aprobada.',
    'mn.send': 'Enviar reto', 'mn.pickBothTitle': 'Elige ambos',
    'mn.pickBothBody': 'Elige primero un oponente y un árbitro.', 'mn.createFail': 'No se pudo crear el combate',

    'md.statusPendingOpponent': 'Esperando al oponente', 'md.statusPendingReferee': 'Esperando al árbitro',
    'md.statusCompleted': 'Completado', 'md.statusDeclined': 'Rechazado', 'md.statusCancelled': 'Cancelado',
    'md.wageredSuffix': 'Elo apostado: el ganador se lo lleva', 'md.wonPot': 'ganó el bote de {n} Elo!',
    'md.stakes': 'EN JUEGO', 'md.wageredWord': 'apostado', 'md.win': 'Gana', 'md.lose': 'Pierde',
    'md.challenger': 'Retador', 'md.opponent': 'Oponente', 'md.winnerTag': 'Ganador', 'md.you': '(tú)',
    'md.referee': 'ÁRBITRO', 'md.whenWhere': 'CUÁNDO Y DÓNDE', 'md.message': 'Mensaje a los participantes',
    'md.public': 'PÚBLICO', 'md.view': 'vista', 'md.views': 'vistas',
    'md.willAppear': 'Este combate aparecerá en Ver cuando el árbitro registre el resultado.',
    'md.result': 'RESULTADO', 'md.draw': 'Empate', 'md.won': 'ganó', 'md.by': 'Por',
    'md.accept': 'Aceptar reto', 'md.decline': 'Rechazar', 'md.waitingAccept': 'Esperando a que {name} acepte…',
    'md.recordResult': 'Registrar el resultado', 'md.whoWon': '¿Quién ganó por sumisión?',
    'md.drawChoice': 'Empate — sin sumisión',
    'md.drawWarn': 'Un empate resta puntuación a AMBOS jugadores, igual que una derrota.',
    'md.finishLabel': 'Finalización (cuenta para la Caza de sumisiones del ganador)',
    'md.notes': 'Notas (opcional)', 'md.notesPlaceholder': 'Algo destacable del combate',
    'md.submitResult': 'Enviar resultado',
    'md.waitingRef': 'Ambos aceptaron. Esperando a que {name} registre el resultado.',
    'md.cancel': 'Cancelar combate', 'md.done': 'Hecho',
    'md.resultRecorded': 'Resultado registrado y puntuaciones actualizadas.', 'md.error': 'Error',
    'md.incomplete': 'Incompleto', 'md.pickWinner': 'Elige al ganador o marca empate.',
    'md.acceptWagerTitle': '¿Aceptar la apuesta?',
    'md.acceptWagerBody': 'Apuestas {n} Elo. Si ganas te lo llevas; si pierdes se va.',
    'md.acceptBtn': 'Aceptar', 'md.tryAgain': 'Inténtalo de nuevo.',

    'gd.member': 'miembro', 'gd.members': 'miembros', 'gd.leave': 'Salir de este gimnasio', 'gd.join': 'Unirse a este gimnasio',
    'gd.welcome': '¡Bienvenido a {name}!', 'gd.requestFriend': 'Solicitar amistad de gimnasio',
    'gd.requestSent': 'Solicitud enviada al dueño del gimnasio.', 'gd.gymFriends': 'Gimnasios amigos',
    'gd.noFriends': 'Aún no hay amistades de gimnasio.', 'gd.friends': 'Amigos', 'gd.wantsConnect': 'Quiere conectar',
    'gd.reqSent': 'Solicitud enviada', 'gd.membersTitle': 'Miembros', 'gd.noMembers': 'Aún no hay miembros.',
    'gd.ownerSuffix': 'dueño',

    'gym.create': 'Crear un gimnasio', 'gym.name': 'Nombre del gimnasio', 'gym.city': 'Ciudad', 'gym.state': 'Estado / región',
    'gym.country': 'País', 'gym.locationHint': 'La ubicación activa las clasificaciones de Ciudad / Estado / País / Continente / Mundo.',
    'gym.descOptional': 'Descripción (opcional)', 'gym.createBtn': 'Crear gimnasio', 'gym.createNew': 'Crear un nuevo gimnasio',
    'gym.search': 'Buscar gimnasios', 'gym.searchPlaceholder': 'Nombre o ciudad', 'gym.yourGymSuffix': 'tu gimnasio',
    'gym.none': 'No se encontraron gimnasios. ¡Crea el primero!', 'gym.nameReqTitle': 'Nombre obligatorio',
    'gym.nameReqBody': 'Dale un nombre a tu gimnasio.', 'gym.createFail': 'No se pudo crear el gimnasio',
  },
  pt: {
    'tab.home': 'Início', 'tab.puzzles': 'Exercícios', 'tab.matches': 'Lutas',
    'tab.community': 'Comunidade', 'tab.profile': 'Perfil', 'tab.ranks': 'Ranking',

    'auth.tagline': 'Avalie seus rolls. Suba no ranking.',
    'auth.email': 'E-mail', 'auth.password': 'Senha', 'auth.signIn': 'Entrar',
    'auth.newHere': 'Novo por aqui?', 'auth.createAccount': 'Criar uma conta',

    'settings.title': 'Configurações', 'settings.language': 'Idioma',
    'settings.languageHint': 'Escolha o idioma em que o app é exibido.', 'settings.account': 'Conta',
    'common.cancel': 'Cancelar', 'common.ok': 'OK',

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

    'result.submission': 'Finalização', 'result.points': 'Pontos', 'result.advantage': 'Vantagem',
    'result.decision': 'Decisão do árbitro', 'result.draw': 'Empate',

    'mn.intro': 'Escolha contra quem você vai rolar e quem arbitra. Ambos devem aceitar/registrar para contar.',
    'mn.competingAs': 'Competir como', 'mn.you': 'Você',
    'mn.juniorNote': 'Sem aposta, não público, o oponente deve ser menor de 18 e o árbitro deve ser faixa azul ou acima e não ser responsável de nenhum dos dois.',
    'mn.opponent': 'Oponente', 'mn.referee': 'Árbitro', 'mn.tapToChoose': 'Toque para escolher',
    'mn.searchOpponent': 'Buscar um oponente', 'mn.searchReferee': 'Buscar um árbitro',
    'mn.searchPlaceholder': 'Nome ou @usuário', 'mn.noMatches': 'Nenhum competidor encontrado.',
    'mn.wagerLabel': 'Aposta (opcional)', 'mn.wagerPlaceholder': 'Elo extra em jogo — o vencedor leva',
    'mn.allIn': 'Tudo', 'mn.none': 'Nenhuma',
    'mn.wagerExplain': 'Num resultado decisivo o vencedor leva o Elo apostado do perdedor, além do Elo normal. Aceitar o desafio significa aceitar a aposta.',
    'mn.publishTitle': 'Publicar publicamente',
    'mn.publishSub': 'Se ambos concordarem, a luta aparece em Assistir para todos verem e reagirem.',
    'mn.pendingConsent': 'Sua conta aguarda a aprovação de um responsável. Você poderá criar uma luta quando for aprovada.',
    'mn.send': 'Enviar desafio', 'mn.pickBothTitle': 'Escolha os dois',
    'mn.pickBothBody': 'Escolha primeiro um oponente e um árbitro.', 'mn.createFail': 'Não foi possível criar a luta',

    'md.statusPendingOpponent': 'Aguardando oponente', 'md.statusPendingReferee': 'Aguardando árbitro',
    'md.statusCompleted': 'Concluído', 'md.statusDeclined': 'Recusado', 'md.statusCancelled': 'Cancelado',
    'md.wageredSuffix': 'Elo apostado — o vencedor leva', 'md.wonPot': 'ganhou o pote de {n} Elo!',
    'md.stakes': 'EM JOGO', 'md.wageredWord': 'apostado', 'md.win': 'Ganha', 'md.lose': 'Perde',
    'md.challenger': 'Desafiante', 'md.opponent': 'Oponente', 'md.winnerTag': 'Vencedor', 'md.you': '(você)',
    'md.referee': 'ÁRBITRO', 'md.whenWhere': 'QUANDO E ONDE', 'md.message': 'Mensagem aos participantes',
    'md.public': 'PÚBLICO', 'md.view': 'visualização', 'md.views': 'visualizações',
    'md.willAppear': 'Esta luta aparecerá em Assistir quando o árbitro registrar o resultado.',
    'md.result': 'RESULTADO', 'md.draw': 'Empate', 'md.won': 'ganhou', 'md.by': 'Por',
    'md.accept': 'Aceitar desafio', 'md.decline': 'Recusar', 'md.waitingAccept': 'Aguardando {name} aceitar…',
    'md.recordResult': 'Registrar o resultado', 'md.whoWon': 'Quem venceu por finalização?',
    'md.drawChoice': 'Empate — sem finalização',
    'md.drawWarn': 'Um empate tira pontuação dos DOIS jogadores — igual a uma derrota.',
    'md.finishLabel': 'Finalização (conta para a Caça às finalizações do vencedor)',
    'md.notes': 'Notas (opcional)', 'md.notesPlaceholder': 'Algo marcante da luta',
    'md.submitResult': 'Enviar resultado',
    'md.waitingRef': 'Ambos aceitaram. Aguardando {name} registrar o resultado.',
    'md.cancel': 'Cancelar luta', 'md.done': 'Pronto',
    'md.resultRecorded': 'Resultado registrado e pontuações atualizadas.', 'md.error': 'Erro',
    'md.incomplete': 'Incompleto', 'md.pickWinner': 'Escolha o vencedor ou marque empate.',
    'md.acceptWagerTitle': 'Aceitar a aposta?',
    'md.acceptWagerBody': 'Você aposta {n} Elo. Se ganhar leva; se perder, foi.',
    'md.acceptBtn': 'Aceitar', 'md.tryAgain': 'Tente novamente.',

    'gd.member': 'membro', 'gd.members': 'membros', 'gd.leave': 'Sair desta academia', 'gd.join': 'Entrar nesta academia',
    'gd.welcome': 'Bem-vindo à {name}!', 'gd.requestFriend': 'Solicitar amizade de academia',
    'gd.requestSent': 'Solicitação enviada ao dono da academia.', 'gd.gymFriends': 'Academias amigas',
    'gd.noFriends': 'Ainda sem amizades de academia.', 'gd.friends': 'Amigas', 'gd.wantsConnect': 'Quer conectar',
    'gd.reqSent': 'Solicitação enviada', 'gd.membersTitle': 'Membros', 'gd.noMembers': 'Ainda sem membros.',
    'gd.ownerSuffix': 'dono',

    'gym.create': 'Criar uma academia', 'gym.name': 'Nome da academia', 'gym.city': 'Cidade', 'gym.state': 'Estado / região',
    'gym.country': 'País', 'gym.locationHint': 'A localização ativa os rankings de Cidade / Estado / País / Continente / Mundo.',
    'gym.descOptional': 'Descrição (opcional)', 'gym.createBtn': 'Criar academia', 'gym.createNew': 'Criar uma nova academia',
    'gym.search': 'Buscar academias', 'gym.searchPlaceholder': 'Nome ou cidade', 'gym.yourGymSuffix': 'sua academia',
    'gym.none': 'Nenhuma academia encontrada. Crie a primeira!', 'gym.nameReqTitle': 'Nome obrigatório',
    'gym.nameReqBody': 'Dê um nome à sua academia.', 'gym.createFail': 'Não foi possível criar a academia',
  },
  fr: {
    'tab.home': 'Accueil', 'tab.puzzles': 'Exercices', 'tab.matches': 'Combats',
    'tab.community': 'Communauté', 'tab.profile': 'Profil', 'tab.ranks': 'Classement',

    'auth.tagline': 'Note tes rolls. Grimpe au classement.',
    'auth.email': 'E-mail', 'auth.password': 'Mot de passe', 'auth.signIn': 'Se connecter',
    'auth.newHere': 'Nouveau ici ?', 'auth.createAccount': 'Créer un compte',

    'settings.title': 'Paramètres', 'settings.language': 'Langue',
    'settings.languageHint': "Choisissez la langue d'affichage de l'application.", 'settings.account': 'Compte',
    'common.cancel': 'Annuler', 'common.ok': 'OK',

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

    'result.submission': 'Soumission', 'result.points': 'Points', 'result.advantage': 'Avantage',
    'result.decision': "Décision de l'arbitre", 'result.draw': 'Nul',

    'mn.intro': 'Choisis ton adversaire et l’arbitre. Les deux doivent accepter/enregistrer pour que ça compte.',
    'mn.competingAs': 'Combattre en tant que', 'mn.you': 'Toi',
    'mn.juniorNote': 'Pas de pari, pas public, l’adversaire doit avoir moins de 18 ans, et l’arbitre doit être ceinture bleue ou plus et n’être le parent d’aucun des deux.',
    'mn.opponent': 'Adversaire', 'mn.referee': 'Arbitre', 'mn.tapToChoose': 'Appuie pour choisir',
    'mn.searchOpponent': 'Chercher un adversaire', 'mn.searchReferee': 'Chercher un arbitre',
    'mn.searchPlaceholder': 'Nom ou @pseudo', 'mn.noMatches': 'Aucun grappler correspondant.',
    'mn.wagerLabel': 'Pari (optionnel)', 'mn.wagerPlaceholder': 'Elo supplémentaire misé — le gagnant l’emporte',
    'mn.allIn': 'Tapis', 'mn.none': 'Aucun',
    'mn.wagerExplain': 'Sur un résultat décisif, le gagnant prend l’Elo misé au perdant, en plus de l’Elo normal. Accepter le défi, c’est accepter le pari.',
    'mn.publishTitle': 'Publier publiquement',
    'mn.publishSub': 'Si les deux acceptent, le combat apparaît dans Regarder pour que tous le voient et réagissent.',
    'mn.pendingConsent': 'Ton compte attend l’approbation d’un parent/tuteur. Tu pourras créer un combat une fois approuvé.',
    'mn.send': 'Envoyer le défi', 'mn.pickBothTitle': 'Choisis les deux',
    'mn.pickBothBody': 'Choisis d’abord un adversaire et un arbitre.', 'mn.createFail': 'Impossible de créer le combat',

    'md.statusPendingOpponent': 'En attente de l’adversaire', 'md.statusPendingReferee': 'En attente de l’arbitre',
    'md.statusCompleted': 'Terminé', 'md.statusDeclined': 'Refusé', 'md.statusCancelled': 'Annulé',
    'md.wageredSuffix': 'Elo misé — le gagnant l’emporte', 'md.wonPot': 'a gagné la cagnotte de {n} Elo !',
    'md.stakes': 'ENJEUX', 'md.wageredWord': 'misé', 'md.win': 'Gagne', 'md.lose': 'Perd',
    'md.challenger': 'Challenger', 'md.opponent': 'Adversaire', 'md.winnerTag': 'Gagnant', 'md.you': '(toi)',
    'md.referee': 'ARBITRE', 'md.whenWhere': 'QUAND ET OÙ', 'md.message': 'Message aux participants',
    'md.public': 'PUBLIC', 'md.view': 'vue', 'md.views': 'vues',
    'md.willAppear': 'Ce combat apparaîtra dans Regarder une fois le résultat enregistré par l’arbitre.',
    'md.result': 'RÉSULTAT', 'md.draw': 'Nul', 'md.won': 'a gagné', 'md.by': 'Par',
    'md.accept': 'Accepter le défi', 'md.decline': 'Refuser', 'md.waitingAccept': 'En attente que {name} accepte…',
    'md.recordResult': 'Enregistrer le résultat', 'md.whoWon': 'Qui a gagné par soumission ?',
    'md.drawChoice': 'Nul — sans soumission',
    'md.drawWarn': 'Un nul retire du classement aux DEUX joueurs — comme une défaite.',
    'md.finishLabel': 'Finition (compte pour la Chasse aux soumissions du gagnant)',
    'md.notes': 'Notes (optionnel)', 'md.notesPlaceholder': 'Quelque chose de notable sur le combat',
    'md.submitResult': 'Envoyer le résultat',
    'md.waitingRef': 'Les deux ont accepté. En attente que {name} enregistre le résultat.',
    'md.cancel': 'Annuler le combat', 'md.done': 'Fait',
    'md.resultRecorded': 'Résultat enregistré et classements mis à jour.', 'md.error': 'Erreur',
    'md.incomplete': 'Incomplet', 'md.pickWinner': 'Choisis le gagnant, ou marque un nul.',
    'md.acceptWagerTitle': 'Accepter le pari ?',
    'md.acceptWagerBody': 'Tu mises {n} Elo. Si tu gagnes tu l’emportes ; si tu perds, c’est perdu.',
    'md.acceptBtn': 'Accepter', 'md.tryAgain': 'Réessaie.',

    'gd.member': 'membre', 'gd.members': 'membres', 'gd.leave': 'Quitter cette salle', 'gd.join': 'Rejoindre cette salle',
    'gd.welcome': 'Bienvenue à {name} !', 'gd.requestFriend': 'Demander une amitié de salle',
    'gd.requestSent': 'Demande envoyée au propriétaire de la salle.', 'gd.gymFriends': 'Salles amies',
    'gd.noFriends': 'Aucune amitié de salle pour l’instant.', 'gd.friends': 'Amies', 'gd.wantsConnect': 'Veut se connecter',
    'gd.reqSent': 'Demande envoyée', 'gd.membersTitle': 'Membres', 'gd.noMembers': 'Aucun membre pour l’instant.',
    'gd.ownerSuffix': 'propriétaire',

    'gym.create': 'Créer une salle', 'gym.name': 'Nom de la salle', 'gym.city': 'Ville', 'gym.state': 'État / région',
    'gym.country': 'Pays', 'gym.locationHint': 'La localisation alimente les classements Ville / État / Pays / Continent / Monde.',
    'gym.descOptional': 'Description (optionnel)', 'gym.createBtn': 'Créer la salle', 'gym.createNew': 'Créer une nouvelle salle',
    'gym.search': 'Chercher des salles', 'gym.searchPlaceholder': 'Nom ou ville', 'gym.yourGymSuffix': 'ta salle',
    'gym.none': 'Aucune salle trouvée. Crée la première !', 'gym.nameReqTitle': 'Nom requis',
    'gym.nameReqBody': 'Donne un nom à ta salle.', 'gym.createFail': 'Impossible de créer la salle',
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
