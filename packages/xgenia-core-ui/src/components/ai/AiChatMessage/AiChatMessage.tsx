import React from 'react';

import { AiIcon } from '@xgenia-core-ui/components/ai/AiIcon';
import { Markdown } from '@xgenia-core-ui/components/common/Markdown';
import { Box } from '@xgenia-core-ui/components/layout/Box';
import { HStack } from '@xgenia-core-ui/components/layout/Stack';
import { UserBadge, UserBadgeSize } from '@xgenia-core-ui/components/user/UserBadge';
import { Slot } from '@xgenia-core-ui/types/global';
import { ReasoningStep } from '@xgenia-ai/ChatPanel/ReasoningEngine';

import css from './AiChatMessage.module.scss';

export type AiChatUser =
  | {
    role: 'user';
    name: string;
  }
  | {
    role: 'assistant';
  }
  | null;

export interface AiChatMessageProps {
  user?: AiChatUser;
  content: string;
  reasoningSteps?: ReasoningStep[];
  affix?: Slot;
}

export function AiChatMessage({ user, content, reasoningSteps, affix }: AiChatMessageProps) {
  return (
    <Box hasXSpacing hasYSpacing UNSAFE_className={css['Root']}>
      <HStack UNSAFE_style={{ height: 'auto', minHeight: '18px' }}>
        {Boolean(user) && (
          <Box hasRightSpacing>
            <div style={{ position: 'relative', width: '18px' }}>
              {user.role === 'user' && (
                <UserBadge size={UserBadgeSize.Tiny} name={user.name} email={user.name} id={user.name} />
              )}
              {user.role === 'assistant' && (
                <AiIcon
                  UNSAFE_style={{
                    position: 'absolute',
                    left: '-3px',
                    top: '-2px'
                  }}
                />
              )}
            </div>
          </Box>
        )}
        <Markdown content={content} UNSAFE_style={{ marginTop: '2px', userSelect: 'text' }} />
      </HStack>

      {reasoningSteps && reasoningSteps.length > 0 && (
        <Box hasTopSpacing UNSAFE_className={css['ReasoningStepsContainer']}>
          {reasoningSteps.map((step) => {
            let stepContentDisplay = null;
            if (step.type === 'tool') {
              try {
                const parsedContent = JSON.parse(step.content);
                if (parsedContent.success === true && parsedContent.image && typeof parsedContent.image === 'string' && parsedContent.image.startsWith('data:image/')) {
                  stepContentDisplay = (
                    <img
                      src={parsedContent.image}
                      alt="Tool output screenshot"
                      style={{ maxWidth: '100%', maxHeight: '400px', border: '1px solid #ccc', marginTop: '8px' }}
                    />
                  );
                } else {
                  // Display other tool results as preformatted text
                  stepContentDisplay = <pre className={css.StepContentPre}>{JSON.stringify(parsedContent, null, 2)}</pre>;
                }
              } catch (e: any) {
                // If JSON.parse fails, display as plain text
                stepContentDisplay = <div className={css.StepContentText}>{step.content}</div>;
              }
            } else {
              // For non-tool steps, display content (could be Markdown too if needed)
              stepContentDisplay = <Markdown content={step.content} UNSAFE_style={{ fontSize: '0.9em' }} />;
            }

            return (
              <Box key={step.id} hasTopSpacing UNSAFE_className={css['ReasoningStepItem']}>
                <div className={css.StepHeader}>
                  <strong>{step.type.charAt(0).toUpperCase() + step.type.slice(1)}:</strong>
                </div>
                {stepContentDisplay}
                {step.reasoning && (
                  <Box hasTopSpacing UNSAFE_className={css['StepReasoning']}>
                    <Markdown content={`*Reasoning: ${step.reasoning}*`} UNSAFE_style={{ fontSize: '0.85em', fontStyle: 'italic', color: '#555' }} />
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      )}

      {Boolean(affix) && <Box hasTopSpacing>{affix}</Box>}
    </Box>
  );
}
