import React, { useCallback, useEffect, useState } from 'react';

import { ProjectModel } from '@xgenia-models/projectmodel';
import { stakeFixRequest, stakeReadiness, type ReadinessReport, type ReadinessIssue } from '@xgenia-utils/stake/stakeReadiness';

import { PrimaryButton } from '@xgenia-core-ui/components/inputs/PrimaryButton';
import { PopupSection } from '@xgenia-core-ui/components/popups/PopupSection';
import { Text } from '@xgenia-core-ui/components/typography/Text';
import { TextType } from '@xgenia-core-ui/components/typography/Text/Text';

import { editorBridge } from '../../../panels/ChatPanelBridge/EditorBridge';

/**
 * Stake readiness, in the Stake tab (2026-11-09): what in this project will break on Stake Engine, before it is
 * exported, with the fix for each — and "Fix with AI", which hands the issues to the XGENIA AI as one request
 * (event `stake-ask-ai`; the AI panel turns it into a chat message, and the AI's `stake` tool re-checks after).
 * The same check the AI runs through the bridge (`stake.readiness`): utils/stake/stakeReadiness.ts.
 */

const COLOURS: Record<ReadinessIssue['level'], string> = { error: '#ff8a8a', warn: '#f5c26b', info: '#9fb3c8' };
const LABELS: Record<ReadinessIssue['level'], string> = { error: 'Must fix', warn: 'Should fix', info: 'Check' };

function openChatPanel() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SidebarModel } = require('@xgenia-models/sidebar');
    const items = SidebarModel.instance.getItems() || [];
    const chat = items.find((i: any) => i.id === 'ChatPanel' || i.id === 'chat-panel');
    if (chat && SidebarModel.instance.getCurrent()?.id !== chat.id) SidebarModel.instance.switch(chat.id);
  } catch (e) {
    console.warn('[Stake readiness] could not open the chat panel', e);
  }
}

export function StakeReadinessSection() {
  const [report, setReport] = useState<ReadinessReport | null>(null);
  const [sent, setSent] = useState(false);

  const check = useCallback(() => {
    try {
      setReport(stakeReadiness((ProjectModel.instance as any)?.toJSON?.()));
    } catch (e: any) {
      setReport({
        ready: false,
        errors: 1,
        warnings: 0,
        issues: [{ code: 'CHECK_FAILED', level: 'error', message: `The Stake check could not read the project: ${e?.message || e}`, fix: 'Save the project and try again.', ai: 'Run stake readiness again.' }],
        summary: { mathsComponents: [], freeSpins: 'none', betModes: false, pickBonus: false }
      });
    }
    setSent(false);
  }, []);

  useEffect(check, [check]);

  const askAi = () => {
    if (!report) return;
    const text = stakeFixRequest(report);
    if (!text) return;
    editorBridge.pushEvent('stake-ask-ai', { text, issues: report.issues.length });
    openChatPanel();
    setSent(true);
  };

  if (!report) return null;
  const headline = report.ready
    ? report.warnings
      ? `Ready to export, with ${report.warnings} thing${report.warnings === 1 ? '' : 's'} Stake's review will likely flag.`
      : 'Ready to export for Stake.'
    : `${report.errors} problem${report.errors === 1 ? '' : 's'} will break this game on Stake.`;

  return (
    <PopupSection>
      <Text hasBottomSpacing textType={TextType.DefaultContrast}>
        Stake readiness
      </Text>
      <Text style={{ fontSize: '12px', color: report.ready ? '#6f6' : COLOURS.error, marginBottom: '8px' }}>{headline}</Text>
      <div style={{ maxHeight: '220px', overflowY: 'auto', marginBottom: '10px' }}>
        {report.issues.map((i, n) => (
          <div key={n} style={{ fontSize: '12px', lineHeight: 1.45, marginBottom: '8px' }}>
            <span style={{ color: COLOURS[i.level], fontWeight: 600 }}>{LABELS[i.level]}</span>
            {i.where ? <span style={{ opacity: 0.7 }}> · {i.where.component}{i.where.label ? ` → ${i.where.label}` : ''}</span> : null}
            <div>{i.message}</div>
            <div style={{ opacity: 0.8 }}>Fix: {i.fix}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        {report.issues.some((i) => i.level !== 'info') && (
          <PrimaryButton label={sent ? 'Sent to the AI' : 'Fix with AI'} onClick={askAi} isDisabled={sent} />
        )}
        <PrimaryButton label="Check again" onClick={check} />
      </div>
    </PopupSection>
  );
}
