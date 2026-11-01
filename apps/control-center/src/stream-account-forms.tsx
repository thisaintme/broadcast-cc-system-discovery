import React from 'react';
import type { ManagementAction, ManagementPanel } from './stream-management-contract.ts';
import type { AccountView } from './stream-management-model.ts';
type Run = (action: ManagementAction) => Promise<void>;
/** Uncontrolled inputs: secrets are never stored in React state, persisted to the browser, or echoed. */
export function SignInSetup({panel,run}:{panel:ManagementPanel;run:Run}) {
  const disabled = panel.busy || !panel.ready || panel.accounts.every(a=>!!a.channel);
  return <details className="card" open={panel.accounts.every(a=>!a.configured)}><summary>Google sign-in setup · once for this app</summary>
    <p>A stream key sends video. Google sign-in lets the app schedule and manage events. You can save a key below without connecting Google.</p>
    <p>In Google Cloud, enable YouTube Data API v3 and create an OAuth client of type <strong>Desktop app</strong>. Enter its details here, or choose its JSON file from this Mac. This configures the destinations that are not yet connected; it does not sign anyone in.</p>
    <form id="desktop-client-setup" autoComplete="off" onSubmit={e=>{e.preventDefault();const f=e.currentTarget;const cid=f.elements.namedItem('clientId') as HTMLInputElement;const sec=f.elements.namedItem('clientSecret') as HTMLInputElement;const value={kind:'setup-client' as const,clientId:cid.value.trim(),clientSecret:sec.value.trim()};f.reset();void run(value);}}>
      <fieldset disabled={disabled}><legend>Desktop app credentials</legend><label>Client ID<input name="clientId" maxLength={300} required spellCheck={false} autoCapitalize="none" autoComplete="off" placeholder="…apps.googleusercontent.com"/></label><label>Client secret (from the Desktop client)<input type="password" name="clientSecret" maxLength={1024} autoComplete="off" spellCheck={false}/></label><div className="actions"><button type="submit">Save sign-in setup</button><button type="button" onClick={()=>void run({kind:'setup-client-file'})}>Choose local Desktop JSON instead…</button></div></fieldset>
    </form><small>Already linked channels keep their authorization. Never enter a Google password here.</small>
  </details>;
}
export function ManualKey({account:a,disabled,run}:{account:AccountView;disabled:boolean;run:Run}) {
  return <section><h4>Use your existing stream key</h4><form id={'key-form-'+a.language} autoComplete="off" onSubmit={e=>{e.preventDefault();const f=e.currentTarget;const input=f.elements.namedItem('streamKey') as HTMLInputElement;const key=input.value;input.value='';void run({kind:'stage-key',language:a.language,key});}}><label>Stream key<input type="password" name="streamKey" required maxLength={2048} autoComplete="off" spellCheck={false} autoCapitalize="none" disabled={disabled} placeholder="Paste the key from YouTube Studio"/></label><button type="submit" disabled={disabled}>Save key on this Mac</button></form>
    <p className="muted">Stored encrypted for this destination. Saving a key does not change OBS, Web Presenter, or the current verified profile.</p>
    {a.keyPending && <div className="notice"><strong>Saved on this Mac · not verified</strong><p>{a.channel?'Verify that the key belongs to this channel before using it for a managed event.':'Connect this channel to verify its key. You do not need to paste it again.'}</p><div className="actions"><button disabled={disabled || !a.channel} onClick={()=>void run({kind:'verify-key',language:a.language})}>Verify saved key</button><button disabled={disabled} onClick={()=>void run({kind:'discard-key',language:a.language})}>Forget unverified key</button></div></div>}
  </section>;
}
