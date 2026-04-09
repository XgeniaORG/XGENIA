import React, { useEffect, useState, ReactNode } from 'react';

import { FeedbackType } from '@xgenia-constants/FeedbackType';
import { CloudService, Environment, CloudServiceType } from '@xgenia-models/CloudServices';
import { ProjectModel } from '@xgenia-models/projectmodel';
import { getCloudServices } from '@xgenia-models/projectmodel.editor';

import {
  PrimaryButton,
  PrimaryButtonSize,
  PrimaryButtonVariant
} from '@xgenia-core-ui/components/inputs/PrimaryButton';
import { TextButton } from '@xgenia-core-ui/components/inputs/TextButton';
import { TextInput, TextInputVariant } from '@xgenia-core-ui/components/inputs/TextInput';
import { Box } from '@xgenia-core-ui/components/layout/Box';
import { Columns } from '@xgenia-core-ui/components/layout/Columns';
import { Modal } from '@xgenia-core-ui/components/layout/Modal/Modal';
import { HStack, VStack } from '@xgenia-core-ui/components/layout/Stack';
import { Text } from '@xgenia-core-ui/components/typography/Text';

import { ToastLayer } from '../../../ToastLayer';

export interface CloudServiceModalProps {
  isVisible: boolean;
  setIsVisible: (value: boolean) => void;

  isActive: boolean;
  environment: Environment;

  onDeleteClick?: () => void;
  onArchiveClick?: () => void;
  onRestoreClick?: () => void;
  onSetEditorClick?: (id: Environment['id']) => void;
  onUnsetEditorClick?: () => void;
}

export function CloudServiceModal(props: CloudServiceModalProps) {
  return <EnhancedCloudServiceModal {...props} />;
}

function EnhancedCloudServiceModal({
  isVisible,
  setIsVisible,
  isActive,
  environment,
  onUnsetEditorClick,
  onDeleteClick,
  onSetEditorClick
}: CloudServiceModalProps) {
  const [name, setName] = useState(environment.name);
  const [description, setDescription] = useState(environment.description);

  // Parse Server fields
  const [appId, setAppId] = useState(environment.appId || '');
  const [url, setUrl] = useState(environment.url || '');
  const [showMasterKey, setShowMasterKey] = useState(false);
  const [masterKey, setMasterKey] = useState(environment.masterKey || '');

  // Supabase fields
  const [supabaseUrl, setSupabaseUrl] = useState(environment.supabaseUrl || environment.url || '');
  const [showAnonKey, setShowAnonKey] = useState(false);
  const [anonKey, setAnonKey] = useState(environment.anonKey || '');
  const [showServiceRoleKey, setShowServiceRoleKey] = useState(false);
  const [serviceRoleKey, setServiceRoleKey] = useState(environment.serviceRoleKey || '');
  const [showAccessToken, setShowAccessToken] = useState(false);
  const [accessToken, setAccessToken] = useState(environment.accessToken || '');
  const [enableRealtime, setEnableRealtime] = useState(environment.enableRealtime !== false);

  // Test connection state
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [isRunningDiagnostics, setIsRunningDiagnostics] = useState(false);
  const [diagnosticResults, setDiagnosticResults] = useState<any>(null);
  const [isActivating, setIsActivating] = useState(false);
  const [activationResult, setActivationResult] = useState<any>(null);
  const [isQuerying, setIsQuerying] = useState(false);
  const [queryResult, setQueryResult] = useState<any>(null);

  const isSupabase = environment.isSupabase();
  const serviceTypeDisplay = isSupabase ? 'Supabase' : 'Parse Server';

  const testSupabaseConnection = async () => {
    if (!isSupabase) return;

    setIsTestingConnection(true);
    setTestResult(null);

    try {
      console.log('[CloudServiceModal] Starting Supabase connection test...');

      // Get the current project model
      const project = ProjectModel.instance;
      if (!project) {
        setTestResult({
          success: false,
          error: 'No active project',
          details: 'ProjectModel.instance is not available'
        });
        return;
      }

      // Create a temporary CloudStore instance with current form values for testing
      console.log('[CloudServiceModal] Importing CloudStore...');
      const CloudStore = require('@xgenia/runtime/src/api/cloudstore');

      if (!CloudStore) {
        setTestResult({
          success: false,
          error: 'CloudStore not available',
          details: 'Could not import CloudStore module'
        });
        return;
      }

      // Create test configuration with current form values
      const testConfig = {
        supabase: {
          enabled: true,
          url: supabaseUrl,
          anonKey: anonKey,
          serviceRoleKey: serviceRoleKey || undefined,
          enableRealtime: false // Disable for test to avoid _realtime errors
        }
      };

      console.log('[CloudServiceModal] Testing connection with config:', {
        url: supabaseUrl,
        hasAnonKey: !!anonKey,
        hasServiceRoleKey: !!serviceRoleKey,
        enableRealtime: false
      });

      // Test the connection with the current form values
      console.log('[CloudServiceModal] Calling CloudStore.testSupabaseConnectionWithConfig...');
      const testResult = await CloudStore.testSupabaseConnectionWithConfig(testConfig);
      console.log('[CloudServiceModal] Test result:', testResult);
      setTestResult(testResult);
    } catch (error: any) {
      console.error('[CloudServiceModal] Test execution failed:', error);
      setTestResult({
        success: false,
        error: 'Test execution failed',
        details: error.message || String(error),
        stack: error.stack
      });
    } finally {
      setIsTestingConnection(false);
    }
  };

  const runComprehensiveDiagnostics = async () => {
    if (!isSupabase) return;

    setIsRunningDiagnostics(true);
    setDiagnosticResults(null);

    try {
      console.log('🔍 === COMPREHENSIVE SUPABASE DIAGNOSTIC STARTING ===');

      const diagnosticResults: any = {
        timestamp: new Date().toISOString(),
        windowType: 'editor',
        tests: {},
        recommendations: [],
        summary: {
          passed: 0,
          failed: 0,
          warnings: 0
        }
      };

      // Helper functions for consistent logging
      function logSuccess(test: string, message: string, details: any = null) {
        console.log(`✅ ${test}: ${message}`);
        if (details) console.log(`   Details:`, details);
        diagnosticResults.tests[test] = { status: 'PASS', message, details };
        diagnosticResults.summary.passed++;
      }

      function logFailure(test: string, message: string, details: any = null) {
        console.log(`❌ ${test}: ${message}`);
        if (details) console.log(`   Details:`, details);
        diagnosticResults.tests[test] = { status: 'FAIL', message, details };
        diagnosticResults.summary.failed++;
      }

      function logWarning(test: string, message: string, details: any = null) {
        console.log(`⚠️  ${test}: ${message}`);
        if (details) console.log(`   Details:`, details);
        diagnosticResults.tests[test] = { status: 'WARN', message, details };
        diagnosticResults.summary.warnings++;
      }

      function addRecommendation(recommendation: string) {
        diagnosticResults.recommendations.push(recommendation);
        console.log(`💡 RECOMMENDATION: ${recommendation}`);
      }

      // ===================================================================
      // TEST 1: WINDOW IDENTIFICATION
      // ===================================================================
      console.log('\n🔍 === TEST 1: WINDOW IDENTIFICATION ===');

      try {
        const windowInfo = {
          hasCloudStore: !!(window as any).XGENIA?.CloudStore,
          hasxgeniaRuntime: !!(window as any).xgeniaRuntime?.instance,
          hasProjectModel: !!(window as any).ProjectModel,
          hasCloudService: !!(window as any).CloudService,
          hasReact: !!(window as any).React,
          hasReactDOM: !!(window as any).ReactDOM,
          url: window.location.href,
          title: document.title,
          userAgent: navigator.userAgent.includes('Electron') ? 'Electron' : 'Browser'
        };

        // Determine window type
        if (windowInfo.hasProjectModel && windowInfo.hasCloudService) {
          diagnosticResults.windowType = 'editor';
          logSuccess('Window Type', 'EDITOR - Correct for configuration testing', windowInfo);
        } else if (windowInfo.hasCloudStore && windowInfo.hasxgeniaRuntime) {
          diagnosticResults.windowType = 'viewer';
          logWarning('Window Type', 'VIEWER - Switch to editor for configuration', windowInfo);
        } else {
          diagnosticResults.windowType = 'unknown';
          logFailure('Window Type', 'UNKNOWN - Cannot identify window type', windowInfo);
        }
      } catch (error: any) {
        logFailure('Window Type', 'ERROR during identification', error.message);
      }

      // ===================================================================
      // TEST 2: EDITOR ENVIRONMENT CHECK
      // ===================================================================
      console.log('\n📝 === TEST 2: EDITOR ENVIRONMENT ===');

      try {
        if ((window as any).ProjectModel?.instance) {
          logSuccess('ProjectModel', 'ProjectModel instance found');

          const editorMetadata = (window as any).ProjectModel.instance.getMetaData('cloudservices');
          if (editorMetadata) {
            logSuccess('Editor Metadata', 'CloudServices metadata found in editor', {
              hasSupabaseConfig: !!editorMetadata.supabase,
              supabaseEnabled: editorMetadata.supabase?.enabled,
              hasRoutingConfig: !!editorMetadata.routing,
              defaultRouting: editorMetadata.routing?.default
            });

            if (editorMetadata.supabase?.enabled && editorMetadata.routing?.default === 'supabase') {
              logSuccess('Editor Configuration', 'Editor has complete Supabase configuration');
            } else {
              logWarning('Editor Configuration', 'Editor configuration incomplete or disabled');
            }
          } else {
            logFailure('Editor Metadata', 'No cloudservices metadata in editor');
          }

          // Check CloudService environments
          if ((window as any).CloudService?.instance?.backend?.items) {
            const environments = (window as any).CloudService.instance.backend.items;
            const supabaseEnvs = environments.filter((env: any) => {
              try {
                return env.isSupabase && env.isSupabase();
              } catch (e: any) {
                return false;
              }
            });

            logSuccess('Cloud Environments', `Found ${environments.length} total, ${supabaseEnvs.length} Supabase`, {
              totalEnvironments: environments.length,
              supabaseEnvironments: supabaseEnvs.length,
              environmentNames: environments.map((env: any) => env.name || env.id)
            });
          }
        } else {
          logWarning('ProjectModel', 'ProjectModel not available in this window');
        }
      } catch (error: any) {
        logFailure('Editor Environment Check', 'ERROR checking editor environment', error.message);
      }

      // ===================================================================
      // TEST 3: SUPABASE PACKAGE VALIDATION
      // ===================================================================
      console.log('\n📦 === TEST 3: PACKAGE VALIDATION ===');

      try {
        let packageCheck;
        try {
          const supabaseModule = require('@supabase/supabase-js');
          packageCheck = {
            packageInstalled: true,
            hasCreateClient: !!supabaseModule.createClient,
            version: supabaseModule.version || 'unknown'
          };
          logSuccess('Supabase Package', 'Package installed and accessible', packageCheck);
        } catch (requireError: any) {
          packageCheck = {
            packageInstalled: false,
            requireError: requireError.message,
            globalAvailable: !!(typeof window !== 'undefined' && (window as any).supabase)
          };

          if (packageCheck.globalAvailable) {
            logWarning('Supabase Package', 'Package available globally but not via require', packageCheck);
          } else {
            logFailure('Supabase Package', 'Package not available', packageCheck);
            addRecommendation('Install @supabase/supabase-js package: npm install @supabase/supabase-js');
          }
        }
      } catch (error: any) {
        logFailure('Package Validation', 'ERROR during package validation', error.message);
      }

      // ===================================================================
      // TEST 4: CONFIGURATION VALIDATION
      // ===================================================================
      console.log('\n🏗️ === TEST 4: CONFIGURATION VALIDATION ===');

      try {
        const configCheck = {
          hasUrl: !!supabaseUrl,
          hasAnonKey: !!anonKey,
          hasServiceRoleKey: !!serviceRoleKey,
          urlValid: false,
          environmentCount: CloudService.instance.backend.items?.length || 0
        };

        if (configCheck.hasUrl) {
          try {
            new URL(supabaseUrl);
            configCheck.urlValid = true;
          } catch (e: any) {
            configCheck.urlValid = false;
          }
        }

        if (configCheck.hasUrl && configCheck.hasAnonKey && configCheck.urlValid) {
          logSuccess('Configuration', 'All required fields present and valid', configCheck);
        } else {
          const missing = [];
          if (!configCheck.hasUrl) missing.push('URL');
          if (!configCheck.hasAnonKey) missing.push('Anonymous Key');
          if (!configCheck.urlValid) missing.push('Valid URL format');

          logFailure('Configuration', `Missing required fields: ${missing.join(', ')}`, configCheck);
          addRecommendation('Fill in all required Supabase configuration fields');
        }
      } catch (error: any) {
        logFailure('Configuration Validation', 'ERROR during configuration validation', error.message);
      }

      // ===================================================================
      // TEST 5: CONNECTION TEST
      // ===================================================================
      console.log('\n🔗 === TEST 5: CONNECTION TEST ===');

      try {
        if (supabaseUrl && anonKey) {
          const testConfig = {
            supabase: {
              enabled: true,
              url: supabaseUrl,
              anonKey: anonKey,
              serviceRoleKey: serviceRoleKey || undefined,
              enableRealtime: false
            }
          };

          const CloudStore = require('@xgenia/runtime/src/api/cloudstore');
          const connectionResult = await CloudStore.testSupabaseConnectionWithConfig(testConfig);

          if (connectionResult.success) {
            logSuccess('Connection Test', connectionResult.message, connectionResult.details);
          } else {
            logFailure('Connection Test', connectionResult.error, connectionResult.details);
            addRecommendation('Check Supabase URL and API keys, verify project is active');
          }
        } else {
          logWarning('Connection Test', 'Skipped - missing URL or API key');
        }
      } catch (error: any) {
        logFailure('Connection Test', 'ERROR during connection test', error.message);
      }

      // ===================================================================
      // TEST 6: INTEGRATION STATUS
      // ===================================================================
      console.log('\n⚙️ === TEST 6: INTEGRATION STATUS ===');

      try {
        const metadata = ProjectModel.instance.getMetaData('cloudservices');
        const metadataCheck = {
          hasMetadata: !!metadata,
          hasSupabaseConfig: !!(metadata && metadata.supabase),
          supabaseEnabled: !!(metadata && metadata.supabase && metadata.supabase.enabled),
          hasRoutingConfig: !!(metadata && metadata.routing),
          defaultBackend: metadata?.routing?.default || 'not_configured'
        };

        if (metadataCheck.hasMetadata && metadataCheck.supabaseEnabled && metadataCheck.defaultBackend === 'supabase') {
          logSuccess('Integration Status', 'Supabase integration fully configured', metadataCheck);
        } else {
          const issues = [];
          if (!metadataCheck.hasMetadata) issues.push('no metadata');
          if (!metadataCheck.hasSupabaseConfig) issues.push('no Supabase config');
          if (!metadataCheck.supabaseEnabled) issues.push('Supabase not enabled');
          if (!metadataCheck.hasRoutingConfig) issues.push('no routing config');
          if (metadataCheck.defaultBackend !== 'supabase') issues.push('routing not set to Supabase');

          logWarning('Integration Status', `Issues found: ${issues.join(', ')}`, metadataCheck);
          addRecommendation('Use the "Activate Integration" button to complete the setup');
        }
      } catch (error: any) {
        logFailure('Integration Status', 'ERROR checking integration status', error.message);
      }

      // ===================================================================
      // GENERATE FINAL REPORT
      // ===================================================================
      console.log('\n📊 === DIAGNOSTIC SUMMARY ===');

      const { passed, failed, warnings } = diagnosticResults.summary;
      const total = passed + failed + warnings;

      console.log(`📈 Tests Run: ${total}`);
      console.log(`✅ Passed: ${passed}`);
      console.log(`❌ Failed: ${failed}`);
      console.log(`⚠️  Warnings: ${warnings}`);

      // Overall status
      if (failed === 0 && warnings <= 2) {
        console.log('🎉 OVERALL STATUS: EXCELLENT - Supabase integration working well!');
        diagnosticResults.overallStatus = 'EXCELLENT';
      } else if (failed <= 2 && warnings <= 4) {
        console.log('👍 OVERALL STATUS: GOOD - Minor issues to address');
        diagnosticResults.overallStatus = 'GOOD';
      } else if (failed <= 4) {
        console.log('⚠️  OVERALL STATUS: NEEDS WORK - Several issues found');
        diagnosticResults.overallStatus = 'NEEDS_WORK';
      } else {
        console.log('❌ OVERALL STATUS: BROKEN - Major configuration issues');
        diagnosticResults.overallStatus = 'BROKEN';
      }

      // Generate automatic recommendations
      if (diagnosticResults.windowType !== 'editor') {
        addRecommendation('This diagnostic is running in the editor - results may differ in viewer');
      }

      if (diagnosticResults.tests['Configuration']?.status === 'FAIL') {
        addRecommendation('Complete the Supabase configuration form above');
      }

      if (diagnosticResults.tests['Connection Test']?.status === 'FAIL') {
        addRecommendation('Verify Supabase project URL and API keys are correct');
      }

      if (diagnosticResults.tests['Integration Status']?.status === 'WARN') {
        addRecommendation('Click "Activate Integration" to complete the setup process');
      }

      // Calculate success rate
      const successRate = total > 0 ? Math.round((passed / total) * 100) : 0;
      diagnosticResults.summary.successRate = successRate;
      diagnosticResults.summary.total = total;

      console.log('\n🔍 === DIAGNOSTIC COMPLETE ===');
      console.log('⏰ Test completed at:', new Date().toLocaleTimeString());

      setDiagnosticResults(diagnosticResults);
    } catch (error: any) {
      console.error('[CloudServiceModal] Diagnostic failed:', error);
      setDiagnosticResults({
        success: false,
        error: 'Diagnostic execution failed',
        details: error.message || String(error),
        timestamp: new Date().toISOString()
      });
    } finally {
      setIsRunningDiagnostics(false);
    }
  };

  const activateSupabaseIntegration = async () => {
    if (!isSupabase) return;

    setIsActivating(true);
    setActivationResult(null);

    try {
      // Step 1: Validate we have the required data
      if (!supabaseUrl || !anonKey) {
        throw new Error('Please fill in the Supabase URL and Anonymous Key before activating');
      }

      console.log('🔧 Starting Supabase integration activation...');

      // Step 2: Ensure the environment is selected as the active cloud service
      console.log('📌 Setting active cloud service environment...');
      if (CloudService.instance && (CloudService.instance as any).setSelectedEnvironment) {
        await (CloudService.instance as any).setSelectedEnvironment((environment as any).id);
        console.log(`✅ Environment ${(environment as any).id} set as active`);
      }

      // Create the complete metadata structure directly
      console.log('📋 Creating complete metadata structure...');
      const completeMetadata = {
        instanceId: (environment as any).id,
        endpoint: supabaseUrl,
        appId: (environment as any).appId || 'supabase-app',
        // Critical: Include the supabase config directly
        supabase: {
          enabled: true,
          url: supabaseUrl,
          anonKey: anonKey,
          serviceRoleKey: serviceRoleKey,
          enableRealtime: enableRealtime
        },
        // Critical: Include the routing config directly
        routing: {
          default: 'supabase',
          collections: {}
        }
      };

      console.log('📋 Complete metadata structure:', JSON.stringify(completeMetadata, null, 2));

      // Apply metadata directly
      ProjectModel.instance.setMetaData('cloudservices', completeMetadata);

      // Force immediate persistence using all available methods
      try {
        // Try various methods that might be available to force save
        if (typeof (ProjectModel.instance as any).markAsChanged === 'function') {
          console.log('💾 Calling markAsChanged() to persist changes...');
          (ProjectModel.instance as any).markAsChanged();
        }

        if (typeof (ProjectModel.instance as any).save === 'function') {
          console.log('💾 Calling save() to persist changes...');
          await (ProjectModel.instance as any).save();
        }

        // CRITICAL: Force immediate save to disk to survive project reloads
        console.log('💾 Forcing immediate project save to disk...');
        if (ProjectModel.instance._retainedProjectDirectory) {
          await new Promise<void>((resolve, reject) => {
            ProjectModel.instance.toDirectory(ProjectModel.instance._retainedProjectDirectory, (result) => {
              if (result.result === 'success') {
                console.log('✅ Project saved successfully with Supabase config');
                resolve();
              } else {
                console.warn('⚠️ Project save failed:', result.message);
                reject(new Error(result.message));
              }
            });
          });
        }

        if (typeof (ProjectModel.instance as any).toJSON === 'function') {
          console.log('📋 Current project state:', (ProjectModel.instance as any).toJSON());
        }

        // Also try to force listeners notification in multiple ways
        ProjectModel.instance.notifyListeners('cloudServicesChanged');
        ProjectModel.instance.notifyListeners('metadataChanged');

        if (typeof (ProjectModel.instance as any).emit === 'function') {
          (ProjectModel.instance as any).emit('metadataChanged.cloudservices');
          (ProjectModel.instance as any).emit('cloudServicesChanged');
        }
      } catch (saveError) {
        console.warn('⚠️ Error during persistence operations:', saveError);
      }

      console.log('💾 Metadata saved and notifications sent');

      // Add a small delay to ensure changes are processed
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Force a re-verification of the current state
      let verificationAttempts = 0;
      const maxAttempts = 5;

      const verifyConfiguration = () => {
        return new Promise((resolve, reject) => {
          const attemptVerification = async () => {
            verificationAttempts++;
            console.log(`🔍 Verification attempt ${verificationAttempts}/${maxAttempts}`);

            // Re-fetch the metadata directly each time to get the latest state
            const currentMetadata = ProjectModel.instance.getMetaData('cloudservices');
            console.log('📋 Current metadata structure:', JSON.stringify(currentMetadata, null, 2));

            // If the verification is failing, try to apply the metadata again
            if (verificationAttempts > 1 && (!currentMetadata?.supabase || !currentMetadata?.routing)) {
              console.log('⚠️ Metadata missing or incomplete, re-applying...');
              ProjectModel.instance.setMetaData('cloudservices', completeMetadata);

              // Try to force persistence again
              try {
                if (typeof (ProjectModel.instance as any).markAsChanged === 'function') {
                  (ProjectModel.instance as any).markAsChanged();
                }
                ProjectModel.instance.notifyListeners('metadataChanged');
              } catch (e: any) {
                console.warn('⚠️ Error during re-application:', e);
              }

              // Add a small delay before next verification attempt
              await new Promise((resolve) => setTimeout(resolve, 300));
            }

            // Check for complete metadata structure
            if (
              currentMetadata &&
              currentMetadata.supabase &&
              currentMetadata.supabase.enabled &&
              currentMetadata.routing &&
              currentMetadata.routing.default === 'supabase'
            ) {
              console.log('✅ Configuration verification successful!');
              resolve({
                success: true,
                message: 'Supabase integration activated successfully!',
                details: {
                  url: currentMetadata.supabase.url,
                  hasAnonKey: !!currentMetadata.supabase.anonKey,
                  hasServiceRoleKey: !!currentMetadata.supabase.serviceRoleKey,
                  realtimeEnabled: currentMetadata.supabase.enableRealtime,
                  defaultBackend: currentMetadata.routing?.default,
                  verificationAttempts: verificationAttempts,
                  metadataComplete: true
                }
              });
              return;
            }

            // Log what's missing for debugging
            const missing = [];
            if (!currentMetadata) missing.push('no metadata');
            else {
              if (!currentMetadata.supabase) missing.push('supabase config');
              else if (!currentMetadata.supabase.enabled) missing.push('supabase not enabled');
              if (!currentMetadata.routing) missing.push('routing config');
              else if (currentMetadata.routing.default !== 'supabase') missing.push('routing not set to supabase');
            }
            console.log(`❌ Verification failed - missing: ${missing.join(', ')}`);

            if (verificationAttempts >= maxAttempts) {
              console.error('❌ Configuration verification failed after maximum attempts');
              reject(
                new Error(
                  `Configuration verification failed after ${maxAttempts} attempts. Missing: ${missing.join(
                    ', '
                  )}. The metadata structure is not being saved correctly.`
                )
              );
              return;
            }

            // Try again after a short delay
            setTimeout(attemptVerification, 300);
          };

          // Start verification immediately
          attemptVerification();
        });
      };

      // Wait for verification
      const result = await verifyConfiguration();
      setActivationResult(result);
    } catch (error: any) {
      console.error('[CloudServiceModal] Activation failed:', error);
      setActivationResult({
        success: false,
        error: 'Activation failed',
        details: error.message || String(error),
        suggestion:
          'The metadata structure is not being preserved correctly. Try refreshing the editor and ensuring your Supabase environment is properly configured in the Cloud Services panel.'
      });
    } finally {
      setIsActivating(false);
    }
  };

  const verifyFullIntegration = async () => {
    if (!isSupabase) return;

    setIsQuerying(true);
    setQueryResult(null);

    try {
      console.log('🔍 === FULL INTEGRATION VERIFICATION ===');

      const verificationResults: any = {
        timestamp: new Date().toISOString(),
        tests: {},
        acceptanceCriteria: {
          metadataStructure: false,
          viewerRuntimeIntegration: false,
          cloudStoreInitialization: false,
          queryRouting: false,
          activationVerification: false
        },
        summary: {
          passed: 0,
          failed: 0,
          total: 5
        }
      };

      // Test 1: Metadata Structure
      console.log('\n📋 Testing metadata structure...');
      try {
        const metadata = ProjectModel.instance.getMetaData('cloudservices');
        const hasCorrectStructure =
          metadata &&
          metadata.supabase &&
          metadata.supabase.enabled === true &&
          metadata.routing &&
          metadata.routing.default === 'supabase';

        if (hasCorrectStructure) {
          verificationResults.acceptanceCriteria.metadataStructure = true;
          verificationResults.summary.passed++;
          verificationResults.tests.metadataStructure = {
            status: 'PASS',
            message: 'Editor metadata has correct supabase and routing structure',
            details: metadata
          };
        } else {
          verificationResults.summary.failed++;
          verificationResults.tests.metadataStructure = {
            status: 'FAIL',
            message: 'Editor metadata missing or incorrect structure',
            details: metadata
          };
        }
      } catch (error: any) {
        verificationResults.summary.failed++;
        verificationResults.tests.metadataStructure = {
          status: 'FAIL',
          message: 'Error checking metadata structure',
          error: error.message
        };
      }

      // Test 2: Viewer Runtime Integration
      console.log('\n🖥️ Testing viewer runtime integration...');
      try {
        const hasXgeniaGlobal = !!(window as any).XGENIA;
        const hasGetMetaData = hasXgeniaGlobal && typeof (window as any).XGENIA.getMetaData === 'function';

        if (hasGetMetaData) {
          const viewerMetadata = (window as any).XGENIA.getMetaData('cloudservices');
          const hasCorrectViewerStructure =
            viewerMetadata &&
            viewerMetadata.supabase &&
            viewerMetadata.supabase.enabled === true &&
            viewerMetadata.routing &&
            viewerMetadata.routing.default === 'supabase';

          if (hasCorrectViewerStructure) {
            verificationResults.acceptanceCriteria.viewerRuntimeIntegration = true;
            verificationResults.summary.passed++;
            verificationResults.tests.viewerRuntimeIntegration = {
              status: 'PASS',
              message: 'Viewer runtime has correct metadata structure',
              details: viewerMetadata
            };
          } else {
            verificationResults.summary.failed++;
            verificationResults.tests.viewerRuntimeIntegration = {
              status: 'FAIL',
              message: 'Viewer runtime metadata missing or incorrect',
              details: viewerMetadata
            };
          }
        } else {
          verificationResults.summary.failed++;
          verificationResults.tests.viewerRuntimeIntegration = {
            status: 'FAIL',
            message: 'window.XGENIA.getMetaData not available',
            details: { hasXgeniaGlobal, hasGetMetaData }
          };
        }
      } catch (error: any) {
        verificationResults.summary.failed++;
        verificationResults.tests.viewerRuntimeIntegration = {
          status: 'FAIL',
          message: 'Error checking viewer runtime integration',
          error: error.message
        };
      }

      // Test 3: CloudStore Initialization
      console.log('\n☁️ Testing CloudStore initialization...');
      try {
        const CloudStore = require('@xgenia/runtime/src/api/cloudstore');
        const hasCloudStore = !!CloudStore;

        if (hasCloudStore) {
          // Try to test if CloudStore can initialize with current config
          const testConfig = {
            supabase: {
              enabled: true,
              url: supabaseUrl,
              anonKey: anonKey,
              serviceRoleKey: serviceRoleKey || undefined,
              enableRealtime: enableRealtime
            }
          };

          const testResult = await CloudStore.testSupabaseConnectionWithConfig(testConfig);

          if (testResult.success) {
            verificationResults.acceptanceCriteria.cloudStoreInitialization = true;
            verificationResults.summary.passed++;
            verificationResults.tests.cloudStoreInitialization = {
              status: 'PASS',
              message: 'CloudStore successfully initializes Supabase backend',
              details: testResult
            };
          } else {
            verificationResults.summary.failed++;
            verificationResults.tests.cloudStoreInitialization = {
              status: 'FAIL',
              message: 'CloudStore failed to initialize Supabase backend',
              details: testResult
            };
          }
        } else {
          verificationResults.summary.failed++;
          verificationResults.tests.cloudStoreInitialization = {
            status: 'FAIL',
            message: 'CloudStore module not available',
            details: null
          };
        }
      } catch (error: any) {
        verificationResults.summary.failed++;
        verificationResults.tests.cloudStoreInitialization = {
          status: 'FAIL',
          message: 'Error testing CloudStore initialization',
          error: error.message
        };
      }

      // Test 4: Query Routing
      console.log('\n🔄 Testing query routing...');
      try {
        const hasXgeniaRecords = !!(window as any).XGENIA?.Records;
        const hasQueryMethod = hasXgeniaRecords && typeof (window as any).XGENIA.Records.query === 'function';

        if (hasQueryMethod) {
          // Try a simple query to test routing
          try {
            const queryResult = await (window as any).XGENIA.Records.query('testtable', {});
            verificationResults.acceptanceCriteria.queryRouting = true;
            verificationResults.summary.passed++;
            verificationResults.tests.queryRouting = {
              status: 'PASS',
              message: 'Query routing to Supabase backend working',
              details: { recordCount: queryResult?.length || 0 }
            };
          } catch (queryError: any) {
            verificationResults.summary.failed++;
            verificationResults.tests.queryRouting = {
              status: 'FAIL',
              message: 'Query routing failed',
              error: queryError.message,
              details: 'Query was routed but failed - check RLS policies'
            };
          }
        } else {
          verificationResults.summary.failed++;
          verificationResults.tests.queryRouting = {
            status: 'FAIL',
            message: 'window.XGENIA.Records.query not available',
            details: { hasXgeniaRecords, hasQueryMethod }
          };
        }
      } catch (error: any) {
        verificationResults.summary.failed++;
        verificationResults.tests.queryRouting = {
          status: 'FAIL',
          message: 'Error testing query routing',
          error: error.message
        };
      }

      // Test 5: Activation Verification
      console.log('\n✅ Testing activation verification...');
      try {
        const metadata = ProjectModel.instance.getMetaData('cloudservices');
        const isActivated =
          metadata &&
          metadata.supabase &&
          metadata.supabase.enabled === true &&
          metadata.routing &&
          metadata.routing.default === 'supabase' &&
          metadata.supabase.url === supabaseUrl &&
          metadata.supabase.anonKey === anonKey;

        if (isActivated) {
          verificationResults.acceptanceCriteria.activationVerification = true;
          verificationResults.summary.passed++;
          verificationResults.tests.activationVerification = {
            status: 'PASS',
            message: 'Supabase environment properly activated',
            details: 'All metadata fields match current configuration'
          };
        } else {
          verificationResults.summary.failed++;
          verificationResults.tests.activationVerification = {
            status: 'FAIL',
            message: 'Activation verification failed',
            details: 'Metadata does not match current configuration'
          };
        }
      } catch (error: any) {
        verificationResults.summary.failed++;
        verificationResults.tests.activationVerification = {
          status: 'FAIL',
          message: 'Error verifying activation',
          error: error.message
        };
      }

      // Generate final assessment
      const allCriteriaMet = Object.values(verificationResults.acceptanceCriteria).every(Boolean);
      const successRate = Math.round((verificationResults.summary.passed / verificationResults.summary.total) * 100);

      console.log('\n📊 === VERIFICATION COMPLETE ===');
      console.log(`✅ Passed: ${verificationResults.summary.passed}/${verificationResults.summary.total}`);
      console.log(`📈 Success Rate: ${successRate}%`);
      console.log(`🎯 All Acceptance Criteria Met: ${allCriteriaMet ? 'YES' : 'NO'}`);

      setQueryResult({
        success: allCriteriaMet,
        message: allCriteriaMet
          ? `🎉 Full Integration Verified! (${successRate}% success rate)`
          : `⚠️ Integration Issues Found (${successRate}% success rate)`,
        data: [],
        details: {
          successRate,
          allCriteriaMet,
          criteriaStatus: verificationResults.acceptanceCriteria
        },
        debugInfo: verificationResults,
        suggestions: allCriteriaMet
          ? [
            '🎉 Congratulations! Your Supabase integration meets all acceptance criteria',
            '✅ Metadata structure is correct in both editor and viewer',
            '✅ CloudStore properly initializes Supabase backend',
            '✅ Query routing works correctly',
            '✅ Environment activation is verified'
          ]
          : [
            '🔧 Use "Activate Integration" button to fix metadata issues',
            '📋 Check that both editor and viewer have correct metadata structure',
            '☁️ Verify CloudStore can initialize Supabase backend',
            '🔄 Test query routing through window.XGENIA.Records.query',
            '✅ Ensure activation verification passes'
          ]
      });
    } catch (error: any) {
      console.error('[CloudServiceModal] Full integration verification failed:', error);
      setQueryResult({
        success: false,
        error: 'Integration verification failed',
        details: error.message || String(error),
        suggestions: [
          'Check console for detailed error information',
          'Ensure Supabase environment is properly configured',
          'Try running "Activate Integration" first'
        ]
      });
    } finally {
      setIsQuerying(false);
    }
  };

  const queryTestTable = async () => {
    if (!isSupabase) return;

    setIsQuerying(true);
    setQueryResult(null);

    try {
      console.log('[CloudServiceModal] Starting testtable query...');

      // Import Supabase client
      const { createClient } = require('@supabase/supabase-js');

      if (!createClient) {
        setQueryResult({
          success: false,
          error: 'Supabase client not available',
          details: 'Could not import createClient from @supabase/supabase-js'
        });
        return;
      }

      // Create Supabase client with current form values
      const supabase = createClient(supabaseUrl, anonKey);

      console.log('[CloudServiceModal] Querying testtable...');

      // Try multiple query approaches to diagnose the issue
      let queryResult = null;
      let queryError = null;
      let debugInfo: any = {};

      // First, try to get basic table info
      try {
        console.log('[CloudServiceModal] Checking table access...');
        const {
          data: tableData,
          error: tableError,
          count
        } = await supabase.from('testtable').select('*', { count: 'exact' });

        debugInfo.tableAccess = {
          error: tableError,
          dataLength: tableData?.length || 0,
          count: count,
          hasData: !!tableData
        };

        console.log('[CloudServiceModal] Table access result:', debugInfo.tableAccess);

        if (tableError) {
          queryError = tableError;
        } else {
          queryResult = tableData;
        }
      } catch (e: any) {
        console.error('[CloudServiceModal] Table access failed:', e);
        debugInfo.tableAccessError = e.message;
      }

      // If basic query failed, try with service role key if available
      if (queryError && serviceRoleKey) {
        try {
          console.log('[CloudServiceModal] Trying with service role key...');
          const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
          const { data: adminData, error: adminError } = await supabaseAdmin
            .from('testtable')
            .select('name, description');

          debugInfo.serviceRoleAttempt = {
            error: adminError,
            dataLength: adminData?.length || 0,
            hasData: !!adminData
          };

          if (!adminError) {
            queryResult = adminData;
            queryError = null;
            debugInfo.usedServiceRole = true;
          }
        } catch (e: any) {
          console.error('[CloudServiceModal] Service role query failed:', e);
          debugInfo.serviceRoleError = e.message;
        }
      }

      // Check RLS policies
      try {
        console.log('[CloudServiceModal] Checking RLS status...');
        const { data: rlsData, error: rlsError } = await supabase
          .rpc('check_table_rls', { table_name: 'testtable' })
          .single();

        debugInfo.rlsCheck = {
          error: rlsError,
          data: rlsData
        };
      } catch (e: any) {
        // RLS check function might not exist, that's okay
        debugInfo.rlsCheckError = 'RLS check function not available';
      }

      if (queryError) {
        console.error('[CloudServiceModal] Query error:', queryError);
        setQueryResult({
          success: false,
          error: 'Query failed',
          details: queryError.message || String(queryError),
          debugInfo: debugInfo,
          suggestions: [
            'Check if Row Level Security (RLS) is enabled on the testtable',
            'Verify that the anon key has SELECT permissions on testtable',
            'Check if there are RLS policies blocking access',
            'Try using the service role key if available'
          ]
        });
        return;
      }

      console.log('[CloudServiceModal] Query successful:', queryResult);
      setQueryResult({
        success: true,
        message: `Successfully fetched ${queryResult?.length || 0} records from testtable`,
        data: queryResult || [],
        details: {
          recordCount: queryResult?.length || 0,
          hasData: (queryResult?.length || 0) > 0
        },
        debugInfo: debugInfo
      });
    } catch (error: any) {
      console.error('[CloudServiceModal] Query execution failed:', error);
      setQueryResult({
        success: false,
        error: 'Query execution failed',
        details: error.message || String(error),
        stack: error.stack,
        suggestions: [
          'Check your Supabase URL and API keys',
          'Verify the testtable exists in your database',
          'Check network connectivity to Supabase'
        ]
      });
    } finally {
      setIsQuerying(false);
    }
  };

  function update() {
    let hasChanges = false;
    const updateData: any = {
      id: environment.id,
      name: undefined,
      description: undefined
    };

    // Check common field changes
    if (name !== environment.name) {
      updateData.name = name;
      hasChanges = true;
    }
    if (description !== environment.description) {
      updateData.description = description;
      hasChanges = true;
    }

    // Check service-specific field changes
    if (isSupabase) {
      if (supabaseUrl !== (environment.supabaseUrl || environment.url)) {
        updateData.supabaseUrl = supabaseUrl;
        hasChanges = true;
      }
      if (anonKey !== (environment.anonKey || '')) {
        updateData.supabaseAnonKey = anonKey;
        hasChanges = true;
      }
      if (serviceRoleKey !== (environment.serviceRoleKey || '')) {
        updateData.supabaseServiceRoleKey = serviceRoleKey;
        hasChanges = true;
      }
      if (accessToken !== (environment.accessToken || '')) {
        updateData.supabaseAccessToken = accessToken;
        hasChanges = true;
      }
      if (enableRealtime !== (environment.enableRealtime !== false)) {
        updateData.supabaseEnableRealtime = enableRealtime;
        hasChanges = true;
      }
    } else {
      // Parse Server
      if (appId !== (environment.appId || '')) {
        updateData.appId = appId;
        hasChanges = true;
      }
      if (masterKey !== (environment.masterKey || '')) {
        updateData.masterKey = masterKey;
        hasChanges = true;
      }
      if (url !== (environment.url || '')) {
        updateData.url = url;
        hasChanges = true;
      }
    }

    // Early return if no changes
    if (!hasChanges) {
      return;
    }

    CloudService.instance.backend
      .update(updateData)
      .then(() => {
        ToastLayer.showSuccess(`Updated ${serviceTypeDisplay} Cloud Service`);
        CloudService.instance.backend.fetch();
      })
      .catch(() => {
        ToastLayer.showError(`Failed to update ${serviceTypeDisplay} Cloud Service`);
      });
  }

  const renderParseServerFields = () => (
    <>
      <Columns hasXGap={4} layoutString="1 1">
        <TextInput
          value={appId}
          variant={TextInputVariant.InModal}
          label="App Id"
          isCopyable
          UNSAFE_style={{ flex: 1 }}
          onChange={(e) => setAppId(e.target.value)}
          onBlur={update}
          onEnter={update}
        />
        <VStack>
          <TextInput
            value={masterKey}
            variant={TextInputVariant.InModal}
            label="Master key"
            type={showMasterKey ? 'text' : 'password'}
            notification={!masterKey ? { type: FeedbackType.Danger } : undefined}
            onChange={(e) => setMasterKey(e.target.value)}
            UNSAFE_style={{ flex: 1 }}
            onFocus={() => {
              setShowMasterKey(true);
            }}
            onBlur={() => {
              setShowMasterKey(false);
              update();
            }}
            onEnter={update}
          />
          {!masterKey && (
            <Box hasTopSpacing={2}>
              <Text textType={FeedbackType.Danger}>
                Missing Master Key, enter the Master Key to be able to use this Cloud Service in the editor.
              </Text>
            </Box>
          )}
          <Box hasTopSpacing={2}>
            <Text>The Master Key is saved locally in an encrypted file.</Text>
          </Box>
        </VStack>
      </Columns>

      <TextInput
        value={url}
        variant={TextInputVariant.InModal}
        label="Parse Server Endpoint"
        isCopyable
        placeholder="https://your-parse-server.com/parse"
        onChange={(e) => setUrl(e.target.value)}
        onBlur={update}
        onEnter={update}
      />
    </>
  );

  const renderSupabaseFields = () => (
    <>
      <TextInput
        value={supabaseUrl}
        variant={TextInputVariant.InModal}
        label="Supabase Project URL"
        isCopyable
        placeholder="https://your-project.supabase.co"
        onChange={(e) => setSupabaseUrl(e.target.value)}
        onBlur={update}
        onEnter={update}
      />

      <TextInput
        value={anonKey}
        variant={TextInputVariant.InModal}
        label="Supabase Anon Key"
        type={showAnonKey ? 'text' : 'password'}
        isCopyable
        notification={!anonKey ? { type: FeedbackType.Danger } : undefined}
        onChange={(e) => setAnonKey(e.target.value)}
        onFocus={() => setShowAnonKey(true)}
        onBlur={() => {
          setShowAnonKey(false);
          update();
        }}
        onEnter={update}
      />

      <TextInput
        value={serviceRoleKey}
        variant={TextInputVariant.InModal}
        label="Supabase Service Role Key (Optional)"
        type={showServiceRoleKey ? 'text' : 'password'}
        isCopyable
        placeholder="Optional - for admin operations"
        onChange={(e) => setServiceRoleKey(e.target.value)}
        onFocus={() => setShowServiceRoleKey(true)}
        onBlur={() => {
          setShowServiceRoleKey(false);
          update();
        }}
        onEnter={update}
      />

      <TextInput
        value={accessToken}
        variant={TextInputVariant.InModal}
        label="Supabase Access Token (Optional)"
        type={showAccessToken ? 'text' : 'password'}
        isCopyable
        placeholder="Optional - for Edge Functions management"
        onChange={(e) => setAccessToken(e.target.value)}
        onFocus={() => setShowAccessToken(true)}
        onBlur={() => {
          setShowAccessToken(false);
          update();
        }}
        onEnter={update}
      />

      {accessToken && (
        <Box hasTopSpacing={1}>
          <Text style={{ fontSize: '12px', color: '#666' }}>
            Access Token enables Edge Functions management and sync capabilities. Get your token from{' '}
            <a href="https://app.supabase.com/account/tokens" target="_blank" rel="noopener noreferrer">
              Supabase Dashboard
            </a>
            .
          </Text>
        </Box>
      )}

      <Box hasTopSpacing={2}>
        <VStack hasSpacing={2}>
          <HStack hasSpacing={2}>
            <input
              type="checkbox"
              id="enableRealtime"
              checked={enableRealtime}
              onChange={(e) => {
                setEnableRealtime(e.target.checked);
                // Trigger update after state change
                setTimeout(update, 10);
              }}
            />
            <label htmlFor="enableRealtime">
              <Text>Enable Realtime subscriptions</Text>
            </label>
          </HStack>
          <Text>
            {!anonKey && (
              <Text textType={FeedbackType.Danger}>
                Missing Anon Key, enter the Anon Key to be able to use this Supabase service in the editor.
              </Text>
            )}
          </Text>
          <Text>Keys are saved locally in an encrypted file.</Text>

          {/* Test Connection Section */}
          <Box hasTopSpacing={2}>
            <PrimaryButton
              label={isTestingConnection ? 'Testing Connection...' : 'Test Connection'}
              size={PrimaryButtonSize.Small}
              variant={PrimaryButtonVariant.MutedOnLowBg}
              onClick={testSupabaseConnection}
              isDisabled={isTestingConnection || !supabaseUrl || !anonKey}
              hasBottomSpacing
            />

            {/* Additional Testing Tools */}
            <HStack hasSpacing={1}>
              <PrimaryButton
                label={isActivating ? 'Activating...' : 'Activate Integration'}
                size={PrimaryButtonSize.Small}
                variant={PrimaryButtonVariant.MutedOnLowBg}
                onClick={activateSupabaseIntegration}
                isDisabled={isActivating || !supabaseUrl || !anonKey}
              />
            </HStack>

            {/* Test Result Display */}
            {testResult && (
              <Box hasTopSpacing={1}>
                <Text
                  textType={testResult.success ? FeedbackType.Success : FeedbackType.Danger}
                  style={{ fontSize: '12px' }}
                >
                  {testResult.success
                    ? '✅ Connection successful!'
                    : `❌ Connection failed: ${testResult.error || 'Unknown error'}`}
                </Text>
                {testResult.details && (
                  <Text style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>
                    {typeof testResult.details === 'object'
                      ? JSON.stringify(testResult.details, null, 2)
                      : testResult.details}
                  </Text>
                )}
              </Box>
            )}

            {/* Diagnostic Results Display */}
            {diagnosticResults && (
              <Box
                hasTopSpacing={2}
                UNSAFE_style={{
                  padding: '8px',
                  backgroundColor: '#f0f8ff',
                  border: '1px solid #b0d4f1',
                  borderRadius: '4px'
                }}
              >
                <Text style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '4px' }}>
                  🔍 Diagnostic Results
                  {diagnosticResults.overall && (
                    <Text
                      style={{
                        fontSize: '10px',
                        marginLeft: '8px',
                        padding: '2px 6px',
                        backgroundColor: diagnosticResults.overall.allPassed ? '#d4edda' : '#fff3cd',
                        color: diagnosticResults.overall.allPassed ? '#155724' : '#856404',
                        borderRadius: '3px'
                      }}
                    >
                      {diagnosticResults.overall.successRate || 0}% Success
                    </Text>
                  )}
                </Text>

                {diagnosticResults.overall && (
                  <Box hasBottomSpacing={1}>
                    <Text style={{ fontSize: '11px', color: '#666' }}>
                      Tests: {diagnosticResults.overall.passed + diagnosticResults.overall.failed} | ✅{' '}
                      {diagnosticResults.overall.passed} | ❌ {diagnosticResults.overall.failed}
                    </Text>
                  </Box>
                )}

                {diagnosticResults.phases && (
                  <VStack hasSpacing={1}>
                    {Object.entries(diagnosticResults.phases).map(([phase, result]: [string, any]) => (
                      <HStack key={phase} hasSpacing={1}>
                        <Text style={{ fontSize: '11px' }}>
                          {result.success ? '✅' : '❌'} {phase.charAt(0).toUpperCase() + phase.slice(1)}
                        </Text>
                        {!result.success && result.error && (
                          <Text style={{ fontSize: '10px', color: '#dc3545' }}>({result.error})</Text>
                        )}
                      </HStack>
                    ))}
                  </VStack>
                )}

                {diagnosticResults.error && (
                  <Text style={{ fontSize: '11px', color: '#dc3545', marginTop: '4px' }}>
                    Error: {diagnosticResults.error}
                  </Text>
                )}
              </Box>
            )}

            {/* Activation Result Display */}
            {activationResult && (
              <Box
                hasTopSpacing={2}
                UNSAFE_style={{
                  padding: '8px',
                  backgroundColor: activationResult.success ? '#d4edda' : '#f8d7da',
                  border: `1px solid ${activationResult.success ? '#c3e6cb' : '#f5c6cb'}`,
                  borderRadius: '4px'
                }}
              >
                <Text
                  style={{
                    fontSize: '12px',
                    fontWeight: 'bold',
                    color: activationResult.success ? '#155724' : '#721c24',
                    marginBottom: '4px'
                  }}
                >
                  {activationResult.success ? '🎉' : '❌'}
                  {activationResult.success ? ' Integration Activated' : ' Activation Failed'}
                </Text>

                {activationResult.message && (
                  <Text
                    style={{
                      fontSize: '11px',
                      color: activationResult.success ? '#155724' : '#721c24',
                      marginBottom: '4px'
                    }}
                  >
                    {activationResult.message}
                  </Text>
                )}

                {activationResult.details && (
                  <Box hasTopSpacing={1}>
                    <Text style={{ fontSize: '10px', color: '#666' }}>
                      {typeof activationResult.details === 'object'
                        ? Object.entries(activationResult.details).map(([key, value]) => (
                          <div key={key}>
                            <strong>{key}:</strong> {String(value)}
                          </div>
                        ))
                        : activationResult.details}
                    </Text>
                  </Box>
                )}

                {activationResult.error && (
                  <Text style={{ fontSize: '11px', color: '#721c24', marginTop: '4px' }}>
                    Error: {activationResult.error}
                  </Text>
                )}
              </Box>
            )}

            {/* Query Result Display */}
            {queryResult && (
              <Box
                hasTopSpacing={2}
                UNSAFE_style={{
                  padding: '8px',
                  backgroundColor: queryResult.success ? '#d4edda' : '#f8d7da',
                  border: `1px solid ${queryResult.success ? '#c3e6cb' : '#f5c6cb'}`,
                  borderRadius: '4px'
                }}
              >
                <Text
                  style={{
                    fontSize: '12px',
                    fontWeight: 'bold',
                    color: queryResult.success ? '#155724' : '#721c24',
                    marginBottom: '4px'
                  }}
                >
                  {queryResult.success ? '📊' : '❌'}
                  {queryResult.success ? ' Query Results' : ' Query Failed'}
                </Text>

                {queryResult.message && (
                  <Text
                    style={{
                      fontSize: '11px',
                      color: queryResult.success ? '#155724' : '#721c24',
                      marginBottom: '4px'
                    }}
                  >
                    {queryResult.message}
                  </Text>
                )}

                {queryResult.success && queryResult.data && queryResult.data.length > 0 && (
                  <Box hasTopSpacing={1}>
                    <Text style={{ fontSize: '11px', fontWeight: 'bold', marginBottom: '4px' }}>
                      Data from testtable:
                    </Text>
                    <VStack hasSpacing={1}>
                      {queryResult.data.map((record: any, index: number) => (
                        <Box
                          key={index}
                          UNSAFE_style={{
                            padding: '4px 6px',
                            backgroundColor: '#f8f9fa',
                            border: '1px solid #dee2e6',
                            borderRadius: '3px'
                          }}
                        >
                          <Text style={{ fontSize: '10px' }}>
                            <strong>Name:</strong> {record.name || 'N/A'}
                          </Text>
                          <Text style={{ fontSize: '10px' }}>
                            <strong>Description:</strong> {record.description || 'N/A'}
                          </Text>
                        </Box>
                      ))}
                    </VStack>
                  </Box>
                )}

                {queryResult.success && queryResult.data && queryResult.data.length === 0 && (
                  <Text style={{ fontSize: '11px', color: '#666', marginTop: '4px' }}>
                    No records found in testtable
                  </Text>
                )}

                {queryResult.details && (
                  <Box hasTopSpacing={1}>
                    <Text style={{ fontSize: '10px', color: '#666' }}>
                      Records found: {queryResult.details.recordCount || 0}
                    </Text>
                  </Box>
                )}

                {queryResult.error && (
                  <Text style={{ fontSize: '11px', color: '#721c24', marginTop: '4px' }}>
                    Error: {queryResult.error}
                  </Text>
                )}

                {queryResult.suggestions && (
                  <Box hasTopSpacing={1}>
                    <Text style={{ fontSize: '11px', fontWeight: 'bold', marginBottom: '2px' }}>Suggestions:</Text>
                    <VStack hasSpacing={0}>
                      {queryResult.suggestions.map((suggestion: string, index: number) => (
                        <Text key={index} style={{ fontSize: '10px', color: '#666' }}>
                          • {suggestion}
                        </Text>
                      ))}
                    </VStack>
                  </Box>
                )}

                {queryResult.debugInfo && (
                  <Box hasTopSpacing={1}>
                    <Text style={{ fontSize: '10px', color: '#666' }}>
                      Debug: {JSON.stringify(queryResult.debugInfo, null, 2)}
                    </Text>
                  </Box>
                )}
              </Box>
            )}
          </Box>
        </VStack>
      </Box>
    </>
  );

  return (
    <Modal
      title={`Manage ${serviceTypeDisplay} cloud service`}
      isVisible={isVisible}
      onClose={() => setIsVisible(false)}
    >
      <Box hasBottomSpacing>
        <VStack hasSpacing>
          {/* Service Type Indicator */}
          <Box hasBottomSpacing={2}>
            <Text>
              <strong>Service Type:</strong> {serviceTypeDisplay}
              {isSupabase && <Text> - PostgreSQL database with real-time subscriptions</Text>}
              {!isSupabase && <Text> - Self-hosted Parse Server with MongoDB</Text>}
            </Text>
          </Box>

          {/* Common Fields */}
          <TextInput
            value={name}
            variant={TextInputVariant.InModal}
            label="Name"
            onChange={(e) => setName(e.target.value)}
            onBlur={update}
            onEnter={update}
          />

          <TextInput
            value={description}
            variant={TextInputVariant.InModal}
            label="Description"
            placeholder={`Describe your ${serviceTypeDisplay} environment`}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={update}
            onEnter={update}
          />

          {/* Service-Specific Fields */}
          {isSupabase ? renderSupabaseFields() : renderParseServerFields()}
        </VStack>
      </Box>

      {/* Action Buttons */}
      {isActive ? (
        <TextButton label="Use editor without backend" onClick={onUnsetEditorClick} />
      ) : (
        <HStack hasSpacing={2}>
          <TextButton label="Unlink service" onClick={onDeleteClick} variant={FeedbackType.Danger} />
          <TextButton
            label="Use in editor"
            onClick={() => {
              // A lil' ugly hack to trigger the overlay
              setTimeout(() => {
                onSetEditorClick && onSetEditorClick(environment.id);
              }, 10);
            }}
          />
        </HStack>
      )}
    </Modal>
  );
}
