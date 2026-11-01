import type { AccountView, CreationPlan, DestinationDraft, EditRequest, Language, ManagementState, PlannedDate, Profile, RemoteBroadcast, Scope, Template } from './stream-management-model.ts';
export interface ManagementPanel {
    state: ManagementState;
    accounts: AccountView[];
    busy: boolean;
    ready: boolean;
    error: string;
    notice: string;
    remote: Partial<Record<Language, RemoteBroadcast[]>>;
}
export type ManagementAction = {
    kind: 'create';
    plan: CreationPlan;
} | {
    kind: 'add-destination';
    occurrenceId: string;
    draft: DestinationDraft;
} | {
    kind: 'edit';
    edit: EditRequest;
} | {
    kind: 'remove';
    occurrenceId: string;
    scope: Scope;
    language?: Language;
} | {
    kind: 'retry' | 'prepare';
    occurrenceId: string;
    language: Language;
} | {
    kind: 'recover';
    occurrenceId: string;
    language: Language;
    broadcastId: string;
} | {
    kind: 'adopt';
    language: Language;
    broadcastId: string;
    madeForKids: boolean;
} | {
    kind: 'configure' | 'connect' | 'disconnect' | 'profiles' | 'forget-key' | 'reveal-key' | 'copy-key' | 'copy-server' | 'refresh';
    language: Language;
} | {
    kind: 'select-profile';
    language: Language;
    profileId: string;
} | {
    kind: 'template';
    template: Template;
} | {
    kind: 'open' | 'copy-link';
    language: Language;
    broadcastId: string;
} | {
    kind: 'operator';
    occurrenceId: string;
    germanOnly: boolean;
} | {
    kind: 'legacy-controls';
};
export interface ManagementReply {
    panel: ManagementPanel;
    profiles?: Profile[];
}
export interface ManagementBridge {
    panel(): Promise<ManagementPanel>;
    preview(plan: CreationPlan): Promise<PlannedDate[]>;
    action(action: ManagementAction): Promise<ManagementReply>;
    cancel(): Promise<void>;
    subscribe(callback: (panel: ManagementPanel) => void): () => void;
}
