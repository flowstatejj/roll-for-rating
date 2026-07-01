# Caching layer plan — Roll for Rating

Scoped 2026-06-29. Ready to execute during the 14-day Android closed test.
Goal: stop refetching the same data on every screen visit, dedupe concurrent
identical fetches, and turn our Realtime channels into cache invalidation.
Entirely JS — ships via OTA, no EAS rebuild.

## Why

- 32 screens each run their own `useCallback load()` + `useEffect`/`useFocusEffect`.
  Every navigation refetches, even for data that rarely changes.
- Home and Matches tab BOTH call `fetchMyMatches(userId)` independently — two
  network calls for the same data; switching tabs refetches from scratch.
- No dedupe, no background revalidation, no shared cache.

## Library

**TanStack Query v5** (`@tanstack/react-query`). JS-only (not a native module),
React 19 compatible. Because it is pure JS it ships via `eas update` OTA — no
store rebuild, so each phase is safe to land during the closed test.

Install (JS-only, `expo install` gotcha does NOT apply):
```
pnpm add @tanstack/react-query
# optional later, for instant-open offline cache:
# pnpm add @tanstack/react-query-persist-client @tanstack/query-async-storage-persister
```

## Architecture

1. **Provider** in `src/app/_layout.tsx`, inside `AuthProvider` (keys use userId):
   ```tsx
   const queryClient = new QueryClient({
     defaultOptions: { queries: {
       staleTime: 30_000,      // treat data fresh for 30s; realtime handles the rest
       gcTime: 5 * 60_000,
       retry: 1,
       refetchOnReconnect: true,
     }},
   });
   <QueryClientProvider client={queryClient}> ... </QueryClientProvider>
   ```
   Note: `refetchOnWindowFocus` is a web concept. On RN, wire `focusManager` to
   `AppState` once (foreground => refetch), or rely on `refetchOnMount` + realtime.

2. **Do NOT rewrite the 151 fetchers.** Keep every `lib/*.ts` fetcher as-is; wrap
   at the call site. Add one thin hook per domain so screens stay consistent:
   ```ts
   // src/lib/queries.ts
   export const useMatches = (userId?: string) =>
     useQuery({ queryKey: qk.matches(userId), queryFn: () => fetchMyMatches(userId!), enabled: !!userId });
   ```

3. **Query keys** in `src/lib/query-keys.ts` (single source of truth):
   ```ts
   export const qk = {
     profile: (uid?: string) => ['profile', uid] as const,
     matches: (uid?: string) => ['matches', uid] as const,
     champions: (uid?: string) => ['champions', uid] as const,
     notifications: (uid?: string) => ['notifications', uid] as const,
     unread: (uid?: string) => ['unread', uid] as const,
     gymMembers: (gymId: string) => ['gymMembers', gymId] as const,
     leaderboard: (scope: string, weight: string) => ['leaderboard', scope, weight] as const,
   };
   ```

4. **Realtime becomes invalidation.** The 5 channels currently call `load()`.
   Swap each for `queryClient.invalidateQueries({ queryKey })`:
   | Channel (file) | Invalidate |
   |---|---|
   | `home-matches` (index.tsx) | `qk.matches(uid)`, `qk.profile(uid)` |
   | `matches-tab` (matches.tsx) | `qk.matches(uid)` |
   | `pending-count` (use-pending.ts) | `qk.matches(uid)` (shared) |
   | `unread-notifs` (use-unread.ts) | `qk.unread(uid)`, `qk.notifications(uid)` |
   | `chat-${id}` (chat/[id].tsx) | `['chat', id]` |
   Keep the user-scoped filters we already added (PR #56).

## Migration order (hot paths first; each phase = one OTA-able PR)

**Phase 1 — matches + profile + champions (the biggest win).**
- Shared `qk.matches(uid)` means Home + Matches tab + pending-count dedupe to ONE
  fetch; tab switches are instant from cache.
- Seed `qk.profile(uid)` from the existing auth context so the profile screen is
  instant on first paint.
- Point the 3 match channels at `invalidateQueries(qk.matches(uid))`.

**Phase 2 — notifications + unread + leaderboards.**
- 2 notification channels => invalidate. Leaderboards get the staleness caching the
  audit wanted for free (staleTime), killing refetch-on-every-scope-toggle.

**Phase 3 — the long tail** (gyms, tournaments, leagues, friends, quests, etc.),
migrated opportunistically as each screen is touched.

## Coexistence + rollout

- react-query coexists with the current `useState`/`useEffect` code during
  migration — convert screen by screen, no big-bang.
- Keep each screen's `useFocusEffect` refetch as a fallback until that screen is
  migrated, then delete it.
- One PR per phase. Each: `tsc --noEmit` + a device smoke test (list loads, pull-to-
  refresh works, realtime still updates live). Ship via OTA.

## Effort

- Phase 1: ~half a day. Phases 2-3: incremental across the closed-test window.
- No native changes, no schema changes, no store rebuild. Fully reversible per PR.
