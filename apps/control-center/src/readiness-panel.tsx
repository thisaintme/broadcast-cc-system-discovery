import React from 'react';
import type {ReadinessIssue} from './readiness.ts';

export function ReadinessPanel({id, title, issues, ready, children}: {
  id: string; title: string; issues: ReadinessIssue[]; ready: string; children?: React.ReactNode;
}) {
  return <div id={id} className="notice" aria-label={title}>
    <strong>{title}</strong>
    {issues.length ? <ul>{issues.map(item => <li key={item.code} data-reason={item.code}>{item.message}</li>)}</ul> : <p>{ready}</p>}
    {children}
  </div>;
}
