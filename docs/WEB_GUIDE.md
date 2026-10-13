# Web foundation guide (read before writing any UI)

Verified facts about what already exists under `web/src`. Do not re-implement these; import them.
The installed library majors are NEW — never rely on memory, read `node_modules/**.d.ts` when unsure.

## Library facts (verified)
- **react-router 8.4**: hooks/components from `'react-router'` (`Link`, `NavLink`, `Navigate`, `Outlet`, `useNavigate`, `useLocation`,
  `useParams`, `useSearchParams`); `RouterProvider` from `'react-router/dom'`. There is NO `react-router-dom`.
  `navigate()` returns a promise → write `void navigate(...)`.
- **radix-ui 1.6** unified package: `import { Dialog as DialogPrimitive, Slot } from 'radix-ui'` → `DialogPrimitive.Root`, `Slot.Root`.
  Prefer the ready wrappers in `@/components/ui/*`.
- **react-resizable-panels 4.13**: exports `Group`, `Panel`, `Separator` (NOT PanelGroup/PanelResizeHandle).
  `Group` props: `orientation="horizontal|vertical"`, `defaultLayout`, `onLayoutChange`, `groupRef`.
  `Panel` props: `id`, `defaultSize`, `minSize`, `maxSize`, `collapsible`, `collapsedSize`, `panelRef`, `onResize`.
  Sizes: a number = pixels; a string without unit = percent (`defaultSize="32"` → 32%, `minSize={300}` → 300px).
  Persistence: `useDefaultLayout({ id, storage })`. Style through `data-separator`, `data-panel`, `data-group` attributes.
- **lucide-react 1.48**: NO brand icons (Github, Twitter, Facebook, Instagram, Linkedin, Youtube, Figma, Slack are absent).
  Canonical names: `LoaderCircle`, `CodeXml`, `CircleCheck`, `CircleX`, `TriangleAlert`, `CircleAlert`, `WandSparkles`,
  `Ellipsis`, `EllipsisVertical`, `FileBraces`, `FileCodeCorner`, `LockOpen`, `Trash` (old aliases such as `Loader2`, `Trash2` still work).
- **sonner 2**: `import { toast } from 'sonner'` (the `<Toaster/>` is mounted in main.tsx).
- **zustand 5**, **@tanstack/react-query 5**, **Tailwind 4.3** (CSS-first), **TypeScript 7** (no `baseUrl`), **Vite 8**.
- `@uiw/react-codemirror` 4.25, `react-markdown` 10 (no `className` prop on the component — wrap it in a div), `diff` 9 (ships its own types).

## Data layer
**`@/lib/api`** — `api.*` (all return typed promises and throw `ApiError`):
- `api.auth.{signup, login, logout, me}`
- `api.me.{update, changePassword, deleteAccount, usage}`, `api.me.apiKeys.{list, set, remove, test}`
- `api.models.list`
- `api.projects.{list, create, get, update, remove, duplicate, remix, downloadUrl}` — `create` returns `CreateProjectResponse { project, generating }`
- `api.files.{list, save, remove, rename}` · `api.versions.{list, create, get, diff, restore}` · `api.messages.{list, clear}`
- `api.chat.stream(projectId, body, onEvent, signal): Promise<void>` · `api.chat.attach(projectId, onEvent, signal): Promise<boolean>` (false on 204) · `api.chat.stop(projectId)`
- `api.uploads.create(file, { projectId?, name?, signal? })`, `api.uploads.url(id)`
- `api.preview.{build, rotateToken}` · `api.publish.{publish, unpublish, slugAvailable(slug, projectId?)}` · `api.community.list`
- Also: `ApiError` (`status`, `code`, `message`, `details`, getters `chatCode`, `issues`), `isApiError`, `isAbortError`. `ApiError.code` may also be `'network'`.

Chat stream contract: events are `ChatEvent` from `@shared/types`. The stream ALWAYS ends with `done { message }`; when the
turn failed an `error` event arrives right before it. `attach` first yields `snapshot { userMessage, assistantMessage }`
(assistant parts accumulated so far), then live events. `/chat/active` is owner-only — never call `attach` in read-only mode.
Aborting the signal only detaches the client; the job keeps running on the server (use `api.chat.stop` to stop it).
`part_delta` for an `action` part of kind `write` carries file content chunks (live code view) — not stored in the part.

**`@/lib/queries`** — keys `qk`; queries `useMe` (data: `User | null`), `useModels`, `useProjects(params)`, `useProject(id)`,
`useMessages(projectId)`, `useVersions(projectId)`, `useVersion`, `useVersionDiff`, `useUsage`, `useApiKeys`, `useCommunity(params)`,
`useCommunityInfinite`, `useBuild`. Mutations with ids in variables: `useLogin`, `useSignup`, `useLogout`, `useUpdateMe`,
`useChangePassword`, `useDeleteAccount`, `useSetApiKey({ provider, ...body })`, `useDeleteApiKey(provider)`, `useTestApiKey(provider)`,
`useCreateProject`, `useUpdateProject({ id, ...patch })`, `useDeleteProject(id)`, `useDuplicateProject(id)`, `useRemixProject(id)`.
Mutations taking `projectId` as hook argument: `useSaveFile`, `useDeleteFile`, `useRenameFile`, `useCreateVersion`,
`useRestoreVersion`, `usePublish`, `useUnpublish`, `useRotatePreviewToken`, `useClearMessages`.
Cache helpers: `invalidateAfterChat(qc, projectId)`, `patchProjectInCache`, `setProjectInCache`, `patchProjectFilesInCache`.
Read the file for exact signatures before use.

**Other lib**: `@/lib/query-client` (`queryClient`), `@/lib/utils` (`cn`, `hashString`, `initials`, `copyToClipboard`, `isMac`),
`@/lib/format` (`relativeTime(iso, locale)`, `formatDate`, `formatDateTime`, `formatTime`, `formatNumber`, `formatBytes`, `formatDuration(ms, locale?)`),
`@/lib/sse` (`createSSEParser`, `streamSSE`). Shared helpers: `@shared/paths` (`languageFor`, `isBinaryPath`, `basename`, `dirname`,
`extname`, `pathError`, `normalizePath`, `versionPreviewUrl`, `countLines`), `@shared/slug` (`slugify`, `slugError`, `isValidSlug`),
`@shared/constants` (`LIMITS`, `APP_NAME`, `PROVIDER_LABELS`, `MODEL_CATALOG`), `@shared/types`.

## UI kit — `@/components/ui/<file>`
- `button`: `Button` (variants default/secondary/outline/ghost/destructive/link/gradient; sizes sm/default/lg/icon/icon-sm; `asChild`, `loading`), `buttonVariants`
- `input`: `Input` · `textarea`: `Textarea` (`autosize`, `minRows`, `maxRows`, `unstyled`) · `label`: `Label`
- `card`: `Card` (`interactive`), `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`
- `badge`: `Badge` (default/secondary/outline/success/warning/destructive/info/gradient)
- `dialog`: `Dialog`, `DialogTrigger`, `DialogClose`, `DialogContent` (`size` sm/md/lg/xl, `hideClose`), `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription`
- `sheet`: `Sheet`, `SheetTrigger`, `SheetClose`, `SheetContent` (`side`), `SheetHeader`, `SheetBody`, `SheetFooter`, `SheetTitle`, `SheetDescription`
- `dropdown-menu`: `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem` (`variant="destructive"`, `inset`), `DropdownMenuCheckboxItem`, `DropdownMenuRadioGroup`, `DropdownMenuRadioItem`, `DropdownMenuLabel`, `DropdownMenuSeparator`, `DropdownMenuShortcut`, `DropdownMenuGroup`, `DropdownMenuSub*`
- `tooltip`: `Tooltip`, `TooltipTrigger`, `TooltipContent`, and the shortcut `Hint` (`label`, `shortcut`, `side`) — `TooltipProvider` is at the root
- `tabs`: `Tabs`, `TabsList` (`variant` segmented/underline), `TabsTrigger`, `TabsContent` · `switch`: `Switch`
- `select`: `Select`, `SelectTrigger` (`size`), `SelectValue`, `SelectContent`, `SelectItem`, `SelectGroup`, `SelectLabel`, `SelectSeparator`
- `separator`, `skeleton` (`Skeleton`), `kbd` (`Kbd`, `KbdGroup`), `progress` (`Progress`), `avatar` (`Avatar`, `AvatarImage`, `AvatarFallback`, `UserAvatar` (`name`, `seed`)),
  `popover` (`Popover`, `PopoverTrigger`, `PopoverContent`), `scroll-area` (`ScrollArea`), `toaster`.
Missing a primitive (e.g. context-menu, accordion, checkbox)? Create it inside YOUR feature folder, not in components/ui.

## Common components — `@/components/common/<File>`
`Logo` (`Logo`, `LogoMark`), `ThemeProvider` (`useTheme()` → `{ theme, resolvedTheme, setTheme, toggleTheme }`), `ThemeToggle`,
`LanguageSwitcher` (`mode` compact/full), `UserMenu`, `AppHeader` (`actions`, `wide`), `Spinner` (`Spinner`, `PageSpinner`),
`EmptyState` (`icon`, `visual`, `title`, `description`, `action`, `size`, `bordered`),
`ConfirmDialog` (`open`, `onOpenChange`, `title`, `description`, `confirmLabel`, `destructive`, `onConfirm` — return a promise for spinner + auto close),
`ProtectedRoute` (`ProtectedRoute`, `loginUrl(next)`, `safeNextPath(next)`), `ErrorBoundary` (`ErrorBoundary` variant page/panel, `ErrorFallback`),
`PageShell` (`PageShell` (`header`, `footer`, `contained`), `PageHeading`, `AppFooter`).

## CSS utilities (web/src/styles/globals.css)
`bg-brand-gradient`, `text-brand-gradient`, `border-brand-gradient`, `brand-glow`, `shadow-brand`, `bg-grid`, `bg-shimmer`,
`scrollbar-thin`, `scrollbar-none`, `container-page`, `animate-fade-up`, `animate-fade-in`, `animate-scale-in`, `animate-shimmer`.
Colour tokens: `bg-background`, `text-foreground`, `bg-card`, `bg-muted`, `text-muted-foreground`, `bg-surface`, `border-border`,
`bg-primary`, `text-primary-foreground`, `text-success`, `text-warning`, `text-destructive`, `text-info`, `from-brand-from`, `via-brand-via`, `to-brand-to`.
Use tokens only — no hard-coded colours. Everything must look right in light AND dark and from 360px wide up.

## i18n — `@/i18n`
```ts
const t = useT('chat');
t('composer.placeholder');
t('confirm.deleteTitle', { name });
t('count.files', { count: 3 });   // resolves count.files_one/_few/_many/_other
const { locale, setLocale } = useLocale();
const errorMessage = useErrorMessage();   // (err) => localized text by ApiErrorCode
getLocale();                              // outside React, e.g. for ChatRequest.locale
```
Fill YOUR namespace(s): replace `web/src/i18n/locales/en/<ns>.ts` with `export const <ns> = { ... } as const;` and in `uz` / `ru`:
`import type { <ns> as en } from '../en/<ns>'; export const <ns> = { ... } as const satisfies DictShape<typeof en>;`
(`DictShape` from `'../../types'`). Missing/extra keys are compile errors. `common` (namespace `common`) is complete: `nav`, `actions`
(save, cancel, delete, …), `terms` (glossary), `status`, `theme`, `language`, `userMenu`, `models`, `confirm`, `errors.*`, `time`, `count.*` — reuse it.
Rules (SPEC §15.10): mandatory glossary; formal tone (Siz / вы); Uzbek Latin typography — use ʻ (U+02BB) in oʻ/gʻ and ʼ (U+02BC)
for tutuq belgisi, never the ASCII apostrophe (write uz strings in double quotes); ru plurals need _one/_few/_many/_other.
Every user-visible string goes through `t()`.

## Workspace store — `@/features/workspace/store`
`useWorkspace` (zustand) exactly as SPEC §11.5. Notes: `reset()` with the same `projectId` is a soft re-sync (keeps view/tabs/drafts).
On Workspace unmount call `useWorkspace.setState({ projectId: null })`. ChatPanel must `setGenerating(false)` when `attach` returns false.

## Existing stubs you replace (keep export names and props)
Pages (default exports): `web/src/pages/{Landing,Home,Login,Signup,Projects,Community,Settings,Workspace}.tsx`.
`ChatPanel({ projectId, readOnly })` in `features/chat/ChatPanel.tsx`; `PreviewPanel({ projectId, previewUrl, readOnly })` in
`features/preview/PreviewPanel.tsx`; `CodePanel({ projectId, readOnly })` in `features/code/CodePanel.tsx`;
`ConnectAiDialog({ open, onOpenChange })` in `features/settings/ConnectAiDialog.tsx`;
`ModelPicker({ value, onChange, compact?, onAddKey? })` in `features/home/ModelPicker.tsx` is already real (also exports `resolveSelectedModel`).

## Rules for all feature agents
- Own only the files listed in your brief. Never edit `web/src/lib/**`, `web/src/components/**`, `web/src/i18n/index.tsx`, `i18n/types.ts`,
  `i18n/resources.ts`, `locales/*/common.ts`, `features/workspace/store.ts`, `App.tsx`, `main.tsx`, `styles/**`, `shared/**`, `server/**`.
  If you need something there, work around it and say so in your report.
- The network is flaky: write files early and often.
- Verify with `npx tsc -p tsconfig.web.json --noEmit` (other agents work in parallel — fix only errors in YOUR files) and finally `npx vite build`.
- A dev API server may be running on http://localhost:3000 (Vite dev on 5173 proxies /api). Do not start or stop servers on ports 3000/5173.
