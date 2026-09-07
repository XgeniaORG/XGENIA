import React, { useEffect, useState } from 'react';
import { platform } from '@xgenia/platform';

import { ActivityIndicator } from '@xgenia-core-ui/components/common/ActivityIndicator';
import { PrimaryButton } from '@xgenia-core-ui/components/inputs/PrimaryButton';
import { Text, TextSize, TextType } from '@xgenia-core-ui/components/typography/Text';

import { PluginLoader } from '../ChatPanelBridge/PluginLoader';
import css from './FeedbackPanel.module.scss';

const FEATUREBASE_BOARD_URL = 'https://xgenia.featurebase.app';
const FEATUREBASE_EMBED_URL = `${FEATUREBASE_BOARD_URL}/?embed=true&theme=dark`;

/**
 * Can the board be embedded IN AN IFRAME right now?
 *
 * EMBEDDING IS A PAID FEATURE OF FEATUREBASE, and the XGENIA workspace is on
 * their free plan (their org payload reports `billing.tierCode: "t0"`,
 * `status: "canceled"`). An embedded board therefore loads, paints, and only
 * then replaces itself with *their* notice — "Not available with the free plan.
 * Please upgrade your account to Starter to use this feature." That verdict is
 * reached inside their iframe several seconds in, which is why this panel used
 * to advertise a working feedback board and then withdraw it.
 *
 * Flip this to true when the Featurebase subscription is back at Starter or
 * above; entitled users then get the inline board instead of the open-in-browser
 * card below.
 *
 * ─── this is NOT an entitlement (2026-09-07) ────────────────────────────────
 * This constant used to be checked ahead of every hook and returned Featurebase's
 * "Not available with the free plan / upgrade to Starter" notice for EVERYONE.
 * Because it short-circuited before the tier gate, the tier gate was dead code:
 * Pro and Enterprise subscribers were blocked exactly like free accounts, and
 * the copy told a paying customer they were on a free plan and should buy a
 * "Starter" plan that XGENIA does not sell. It is a statement about OUR
 * Featurebase billing, so it may only pick HOW an entitled user reaches the
 * board — never WHETHER they may.
 */
const FEATUREBASE_EMBED_AVAILABLE: boolean = false;

type Access =
  /** No tier known yet — paint neither the board nor the block. */
  | 'checking'
  /** Free tier: the block, and the board is never reachable. */
  | 'blocked'
  | 'allowed'
  /** Couldn't establish a tier (server unreachable, or it failed closed). */
  | 'unknown';

/**
 * Map an entitlements tier onto what this panel should paint.
 *
 * The server normalizes to exactly free|pro|enterprise (see the TIER_RANK table
 * and normalizeTier in edge-functions/plugin-entitlements), so 'free' is the
 * only real block. It is written as an allow-all-but-free rather than a rank
 * check because a dev build rewrites 'free' to 'dev' (PluginLoader.mergeDev)
 * and a tier this code has not heard of should let the user through.
 *
 * 'unverified' is the exception, and it is not a plan: PluginLoader returns it
 * when it fails closed after a failed fetch with no usable cache. That resolves
 * rather than rejects, so without this it fell through allow-all-but-free and
 * handed the board to everyone whose entitlements check had just failed.
 */
function accessForTier(tier: string | null): Access {
  if (!tier) return 'checking';
  if (tier === 'unverified') return 'unknown';
  return tier === 'free' ? 'blocked' : 'allowed';
}

export function FeatureBaseWidget() {
  return <EntitledFeatureBaseBoard />;
}

function EntitledFeatureBaseBoard() {
  // Decided synchronously so a free account gets the block on the FIRST frame
  // rather than after a round-trip: a panel that shows a feature before
  // withdrawing it is worse than one that never showed it.
  const [access, setAccess] = useState<Access>(() => accessForTier(PluginLoader.instance.getCachedTier()));
  const [tier, setTier] = useState(() => PluginLoader.instance.getCachedTier() || '');

  useEffect(() => {
    let cancelled = false;

    function apply(nextTier: string) {
      setTier(nextTier);
      setAccess(accessForTier(nextTier));
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

  // Entitled from here down.
  //
  // The iframe is only mounted when the workspace can actually serve one;
  // otherwise the board opens in the browser, which needs no Featurebase embed
  // entitlement. Either way a paying subscriber gets a way through.
  if (!FEATUREBASE_EMBED_AVAILABLE) {
    return (
      <div className={css['stateContainer']}>
        <Text size={TextSize.Medium} isCentered hasBottomSpacing>
          Feedback &amp; feature requests
        </Text>
        <Text textType={TextType.Shy} isCentered hasBottomSpacing>
          The board opens in your browser.
        </Text>
        <PrimaryButton label="Open feedback board" onClick={() => platform.openExternal(FEATUREBASE_BOARD_URL)} />
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
