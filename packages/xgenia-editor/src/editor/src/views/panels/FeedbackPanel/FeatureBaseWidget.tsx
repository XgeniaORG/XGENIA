import React, { useEffect, useState } from 'react';
import { platform } from '@xgenia/platform';
import { ActivityIndicator } from '@xgenia-core-ui/components/common/ActivityIndicator';
import { PrimaryButton, PrimaryButtonSize, PrimaryButtonVariant } from '@xgenia-core-ui/components/inputs/PrimaryButton';
import { Text, TextSize, TextType } from '@xgenia-core-ui/components/typography/Text';

import { PluginLoader } from '../ChatPanelBridge/PluginLoader';
import css from './FeedbackPanel.module.scss';

const FEATUREBASE_BOARD_URL = 'https://xgenia.featurebase.app';
const FEATUREBASE_EMBED_URL = `${FEATUREBASE_BOARD_URL}/?embed=true&theme=dark`;

/**
 * Can the board be embedded at all right now?
 *
 * EMBEDDING IS A PAID FEATURE OF FEATUREBASE, and the XGENIA workspace is on
 * their free plan (their org payload reports `billing.tierCode: "t0"`,
 * `status: "canceled"`). An embedded board therefore loads, paints, and only
 * then replaces itself with *their* notice — "Not available with the free plan.
 * Please upgrade your account to Starter to use this feature." That verdict is
 * reached inside their iframe several seconds in, which is why this panel used
 * to advertise a working feedback board and then withdraw it.
 *
 * Nothing on our side can make their notice arrive sooner, so the decision is
 * made here instead, before anything is mounted. Flip this to true when the
 * Featurebase subscription is back at Starter or above; the tier gate below
 * then takes over.
 */
const FEATUREBASE_EMBED_AVAILABLE: boolean = false;

/**
 * Every tier except 'free' may open the board. Named as an allow-of-one rather
 * than a rank check because the tier strings come from the entitlements server
 * and a dev build rewrites 'free' to 'dev' (see PluginLoader.mergeDev) — an
 * unknown tier should let the user through, not lock them out.
 */
function isBlockedTier(tier: string | null): boolean {
  return tier === 'free';
}

export function FeatureBaseWidget() {
  // Ahead of every hook on purpose: while the embed is unavailable the panel
  // must not reach the network, mount an iframe, or spend a frame looking like
  // a feedback board that is about to work.
  if (!FEATUREBASE_EMBED_AVAILABLE) {
    return <EmbedUnavailableNotice />;
  }

  return <EntitledFeatureBaseBoard />;
}

function EmbedUnavailableNotice() {
  return (
    <div className={css['stateContainer']}>
      <Text size={TextSize.Medium} isCentered hasBottomSpacing>
        Not available with the free plan
      </Text>

      <Text textType={TextType.Shy} isCentered hasBottomSpacing>
        The feedback board is embedded from Featurebase, and embedding it in the editor needs their Starter plan.
        The board itself still works in a browser.
      </Text>

      <PrimaryButton
        size={PrimaryButtonSize.Small}
        label="Open feedback board in browser"
        variant={PrimaryButtonVariant.MutedOnLowBg}
        onClick={() => platform.openExternal(FEATUREBASE_BOARD_URL)}
      />
    </div>
  );
}

type Access =
  /** No tier known yet — paint neither the board nor the block. */
  | 'checking'
  /** Free tier: the block, and the iframe is never mounted. */
  | 'blocked'
  | 'allowed'
  /** Couldn't reach the entitlements server and nothing was cached. */
  | 'unknown';

function EntitledFeatureBaseBoard() {
  // Decided synchronously so a free account gets the block on the FIRST frame
  // rather than after a round-trip, for the same reason the embed check above
  // is a constant: a panel that shows a feature before withdrawing it is worse
  // than one that never showed it.
  const [access, setAccess] = useState<Access>(() => {
    const cached = PluginLoader.instance.getCachedTier();
    if (cached === null) return 'checking';
    return isBlockedTier(cached) ? 'blocked' : 'allowed';
  });
  const [tier, setTier] = useState(() => PluginLoader.instance.getCachedTier() || '');

  useEffect(() => {
    let cancelled = false;

    function apply(nextTier: string) {
      setTier(nextTier);
      setAccess(isBlockedTier(nextTier) ? 'blocked' : 'allowed');
    }

    PluginLoader.instance
      .getEntitledPlugins()
      .then((entitlements) => {
        if (cancelled) return;
        apply(entitlements.tier);
      })
      .catch(() => {
        if (cancelled) return;
        // Keep whatever the cache already decided; only a first run with no
        // cache and no server reaches the unknown state.
        setAccess((current) => (current === 'checking' ? 'unknown' : current));
      });

    // Unblock without a restart when the user upgrades mid-session.
    const unsub = PluginLoader.instance.onChange((e) => {
      if (!e || cancelled) return;
      apply(e.tier);
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  if (access === 'checking') {
    return (
      <div className={css['stateContainer']}>
        <ActivityIndicator />
      </div>
    );
  }

  if (access === 'blocked') {
    return (
      <div className={css['stateContainer']}>
        <Text size={TextSize.Medium} isCentered hasBottomSpacing>
          Feedback &amp; feature requests require a Pro subscription
        </Text>
        <Text textType={TextType.Shy} isCentered>
          Current plan: {tier || 'free'}
        </Text>
      </div>
    );
  }

  if (access === 'unknown') {
    return (
      <div className={css['stateContainer']}>
        <Text textType={TextType.Shy} isCentered>
          Could not check your plan. Reconnect and reopen this panel to try again.
        </Text>
      </div>
    );
  }

  return (
    <div className={css['featurebaseContainer']}>
      <iframe
        src={FEATUREBASE_EMBED_URL}
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          backgroundColor: '#272625'
        }}
        title="Featurebase Feedback"
        allowFullScreen
      />
    </div>
  );
}
