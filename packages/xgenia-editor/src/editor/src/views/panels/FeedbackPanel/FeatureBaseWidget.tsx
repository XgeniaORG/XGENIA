import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator } from '@xgenia-core-ui/components/common/ActivityIndicator';
import { Text, TextType } from '@xgenia-core-ui/components/typography/Text';
import { Container, ContainerDirection } from '@xgenia-core-ui/components/layout/Container';
import { FeedbackType } from '@xgenia-constants/FeedbackType';
import css from './FeedbackPanel.module.scss';

// Extend the Window interface to include FeatureBase
declare global {
  interface Window {
    Featurebase?: {
      initialize: (config: any) => void;
      render: (selector: string, config: any) => void;
    };
  }
}

export function FeatureBaseWidget() {
  console.log('FeatureBaseWidget component mounted and rendering');
  
  useEffect(() => {
    console.log('FeatureBaseWidget useEffect triggered - using iframe embed');
  }, []);

  return (
    <div style={{ height: '100%', width: '100%' }}>
      <iframe
        src="https://xgenia.featurebase.app/?embed=true&theme=dark"
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