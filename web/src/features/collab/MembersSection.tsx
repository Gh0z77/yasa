import { useId, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Users, X } from 'lucide-react';
import { toast } from 'sonner';
import type { MembersResponse, Project, ProjectMemberRole } from '@shared/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useErrorMessage, useT } from '@/i18n';
import { api } from '@/lib/api';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const membersKey = (projectId: string) => ['members', projectId] as const;

/** People the owner shares the project with: invite by email, pick a role, remove. */
export function MembersSection({ project, enabled }: { project: Project; enabled: boolean }) {
  const t = useT('shell');
  const errorMessage = useErrorMessage();
  const qc = useQueryClient();
  const uid = useId();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ProjectMemberRole>('editor');

  const members = useQuery({
    queryKey: membersKey(project.id),
    queryFn: ({ signal }) => api.members.list(project.id, { signal }),
    enabled,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: membersKey(project.id) });

  const invite = useMutation({
    mutationFn: (input: { email: string; role: ProjectMemberRole }) => api.members.set(project.id, input),
    onSuccess: ({ member }) => {
      qc.setQueryData<MembersResponse>(membersKey(project.id), (old) =>
        old ? { ...old, members: [...old.members.filter((m) => m.email !== member.email), member] } : old,
      );
      setEmail('');
      toast.success(t('members.added', { email: member.email }));
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: (address: string) => api.members.remove(project.id, address),
    onSuccess: () => void refresh(),
    onError: (err) => toast.error(errorMessage(err)),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const address = email.trim().toLowerCase();
    if (EMAIL.test(address) && !invite.isPending) invite.mutate({ email: address, role });
  };

  return (
    <div className="rounded-xl border border-border p-3">
      <div className="flex items-start gap-3">
        <Users className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <Label htmlFor={`${uid}-email`} className="text-[13px]">
            {t('members.title')}
          </Label>
          <p className="mt-0.5 text-[12px] text-muted-foreground">{t('members.hint')}</p>
        </div>
      </div>

      <form onSubmit={submit} className="mt-3 flex flex-wrap items-center gap-2">
        <Input
          id={`${uid}-email`}
          type="email"
          name="member-email"
          autoComplete="off"
          placeholder={t('members.emailPlaceholder')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-9 min-w-[11rem] flex-1"
        />
        <Select value={role} onValueChange={(value) => setRole(value as ProjectMemberRole)}>
          <SelectTrigger className="h-9 w-[8.5rem]" aria-label={t('members.role')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="editor">{t('members.editor')}</SelectItem>
            <SelectItem value="viewer">{t('members.viewer')}</SelectItem>
          </SelectContent>
        </Select>
        <Button type="submit" size="sm" loading={invite.isPending} disabled={!EMAIL.test(email.trim())}>
          {t('members.invite')}
        </Button>
      </form>

      {members.data && members.data.members.length > 0 ? (
        <ul className="mt-3 divide-y divide-border">
          {members.data.members.map((member) => (
            <li key={member.email} className="flex items-center gap-3 py-2 text-[13px]">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{member.name ?? member.email}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {member.name ? member.email : t('members.pending')}
                </span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{t(member.role === 'editor' ? 'members.editor' : 'members.viewer')}</span>
              <button
                type="button"
                aria-label={t('members.remove', { email: member.email })}
                title={t('members.remove', { email: member.email })}
                onClick={() => remove.mutate(member.email)}
                disabled={remove.isPending}
                className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/45"
              >
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
