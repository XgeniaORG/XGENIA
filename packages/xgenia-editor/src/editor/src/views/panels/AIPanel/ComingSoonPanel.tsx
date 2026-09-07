import React, { useEffect, useState } from 'react';
import { BasePanel } from '@xgenia-core-ui/components/sidebar/BasePanel';
import { Box } from '@xgenia-core-ui/components/layout/Box';
import { VStack, HStack } from '@xgenia-core-ui/components/layout/Stack';
import { Text, TextType } from '@xgenia-core-ui/components/typography/Text';
import { Title, TitleSize } from '@xgenia-core-ui/components/typography/Title';
import { Icon, IconName, IconSize } from '@xgenia-core-ui/components/common/Icon';
import { PrimaryButton, PrimaryButtonSize, PrimaryButtonVariant } from '@xgenia-core-ui/components/inputs/PrimaryButton';
import { usePanelActive } from '../useIsActivePanel';

// Import both module CSS files
import panelCss from './AIPanel.module.scss';
import styles from './ComingSoonPanel.module.scss';

// Export the same panel ID as AIPanel to ensure compatibility
export const AIPanel_ID = 'ai-panel';

export function ComingSoonPanel() {
  const isPanelActive = usePanelActive();
  // Animation values for elements fading in
  const [isVisible, setIsVisible] = useState(false);
  const [dotsCount, setDotsCount] = useState(0);

  // Trigger entrance animation on component mount
  useEffect(() => {
    const entrance = setTimeout(() => setIsVisible(true), 100);
    return () => clearTimeout(entrance);
  }, []);

  // Animate the dots — only while the panel is on screen. This panel stays
  // mounted behind whatever the user switches to, and a "..." animation nobody
  // can see was re-rendering it twice a second for the rest of the session.
  useEffect(() => {
    if (!isPanelActive) return;
    const interval = setInterval(() => {
      setDotsCount((prev) => (prev + 1) % 4);
    }, 500);

    return () => clearInterval(interval);
  }, [isPanelActive]);

  const dots = '.'.repeat(dotsCount);
  
  // Custom gradient background style
  const gradientStyle: React.CSSProperties = {
    background: 'radial-gradient(circle at 30% 40%, rgba(64, 64, 90, 0.5) 0%, rgba(32, 32, 42, 0.3) 100%)',
    borderRadius: '16px',
    backdropFilter: 'blur(5px)',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2), inset 0 1px rgba(255, 255, 255, 0.1)',
    padding: '3rem 2rem',
    width: '90%',
    maxWidth: '500px',
    marginTop: '-40px',
    transition: 'all 0.5s ease-out',
    opacity: isVisible ? 1 : 0,
    transform: isVisible ? 'translateY(0)' : 'translateY(20px)',
  };

  const iconWrapperStyle: React.CSSProperties = {
    background: 'rgba(73, 93, 155, 0.2)',
    borderRadius: '50%',
    padding: '20px',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: '16px',
    boxShadow: '0 0 30px rgba(73, 93, 155, 0.4)',
    transition: 'all 0.6s ease-out',
    transform: isVisible ? 'scale(1)' : 'scale(0.8)',
    opacity: isVisible ? 1 : 0,
  };

    // We'll use our CSS module for animations

  return (
    <BasePanel title="Deep Research">
      <Box
        UNSAFE_style={{
          display: 'flex',
          flexDirection: 'column',
          height: 'calc(100vh - 60px)', // Account for panel header
          minHeight: '500px',
          justifyContent: 'center',
          alignItems: 'center',
          textAlign: 'center',
          padding: '1rem',
          background: 'linear-gradient(135deg, #1a1a20 0%, #24242f 100%)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Decorative background elements with animation */}
        <div className={styles.glowingOrb} style={{
          top: '5%',
          left: '10%',
          width: '20px',
          height: '20px',
          opacity: isVisible ? 0.6 : 0,
        }} />
        <div className={styles.glowingOrb} style={{
          top: '30%',
          left: '80%',
          width: '28px',
          height: '28px',
          background: 'rgba(100, 120, 220, 0.25)',
          opacity: isVisible ? 0.5 : 0,
          animationDelay: '2s',
        }} />
        <div className={styles.glowingOrb} style={{
          bottom: '15%',
          right: '15%',
          width: '35px',
          height: '35px',
          background: 'rgba(91, 120, 200, 0.2)',
          filter: 'blur(12px)',
          opacity: isVisible ? 0.5 : 0,
          animationDelay: '1s',
        }} />
        <div className={styles.glowingOrb} style={{
          bottom: '40%',
          left: '20%',
          width: '18px',
          height: '18px',
          background: 'rgba(140, 160, 240, 0.2)',
          opacity: isVisible ? 0.4 : 0,
          animationDelay: '3s',
        }} />

        {/* Main content card with gradient */}
        <div style={gradientStyle}>
          <VStack hasSpacing={6} UNSAFE_style={{ alignItems: 'center' }}>
            {/* Icon with pulse effect */}
            <div style={iconWrapperStyle}>
              <Icon
                icon={IconName.Search}
                size={IconSize.Large}
                UNSAFE_style={{ fontSize: '54px', color: '#8AA0DE', animation: 'pulse 2s infinite' }}
              />
            </div>
            
            {/* Title with animated dots */}
            <div style={{ 
              transition: 'all 0.7s ease-out', 
              opacity: isVisible ? 1 : 0,
              transform: isVisible ? 'translateY(0)' : 'translateY(10px)',
            }}>
              <Title size={TitleSize.Medium}>
                <span style={{ color: '#ffffff', letterSpacing: '0.5px' }}>Deep Research{dots}</span>
              </Title>
            </div>
            
            {/* Coming Soon text */}
            <div style={{ 
              transition: 'all 0.8s ease-out', 
              opacity: isVisible ? 1 : 0,
              transform: isVisible ? 'translateY(0)' : 'translateY(10px)',
            }}>
              <Text textType={TextType.Proud}>
                <span style={{ fontWeight: 600, fontSize: '22px', color: '#8AA0DE' }}>Coming Soon</span>
              </Text>
            </div>
            
            {/* Description text */}
            <div style={{ 
              transition: 'all 0.9s ease-out',
              opacity: isVisible ? 0.9 : 0,
              transform: isVisible ? 'translateY(0)' : 'translateY(10px)',
              maxWidth: '400px',
            }}>
              <Text textType={TextType.Default}>
                <span style={{ lineHeight: '1.6', color: '#d0d0d8', display: 'inline-block' }}>
                  Our Deep Research feature is under development and will be available soon.
                  Stay tuned for powerful web search capabilities integrated directly into your workflow.
                </span>
              </Text>
            </div>

            {/* Notification button */}
            <div style={{ 
              transition: 'all 1s ease-out',
              opacity: isVisible ? 1 : 0,
              transform: isVisible ? 'translateY(0)' : 'translateY(10px)',
              marginTop: '8px',
            }}>
              <PrimaryButton
                label="Stay Tuned"
                size={PrimaryButtonSize.Small}
                variant={PrimaryButtonVariant.Muted}
                onClick={() => {}}
                UNSAFE_style={{
                  background: 'linear-gradient(135deg, #495D9B 0%, #3A4C85 100%)',
                  border: 'none',
                  boxShadow: '0 4px 10px rgba(73, 93, 155, 0.3)',
                }}
              />
            </div>
          </VStack>
        </div>
      </Box>
    </BasePanel>
  );
}
