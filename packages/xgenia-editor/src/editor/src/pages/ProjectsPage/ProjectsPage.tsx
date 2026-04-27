import { ipcRenderer } from 'electron';
import React, { useEffect, useState, ReactNode, Fragment, useRef } from 'react';
// Import Fragment
import { platform } from '@xgenia/platform';

// import Logo from './logo.svg';

import { ProjectModel } from '@xgenia-models/projectmodel';
import getDocsEndpoint from '@xgenia-utils/getDocsEndpoint';
import { LocalProjectsModel } from '@xgenia-utils/LocalProjectsModel';

import { Icon, IconName } from '@xgenia-core-ui/components/common/Icon';
import { Logo, LogoSize } from '@xgenia-core-ui/components/common/Logo';
import { IconButton, IconButtonVariant } from '@xgenia-core-ui/components/inputs/IconButton';
import { TextButton } from '@xgenia-core-ui/components/inputs/TextButton';
import { HStack } from '@xgenia-core-ui/components/layout/Stack';
import { MenuDialog, MenuDialogWidth } from '@xgenia-core-ui/components/popups/MenuDialog';
import { Tooltip } from '@xgenia-core-ui/components/popups/Tooltip';

import { EventDispatcher } from '../../../../shared/utils/EventDispatcher';
import { useAuth } from '../../context/AuthContext';
import { IRouteProps } from '../../pages/AppRoute';
import { getUserDisplayName } from '../../utils/userUtils';
import { Frame } from '../../views/common/Frame';
import { ProjectsView } from '../../views/projectsview';
import { BaseWindow } from '../../views/windows/BaseWindow';

export interface ProjectsPageProps extends IRouteProps {
  from: TSFixme;
}

export function ProjectsPage({ route, from }: ProjectsPageProps) {
  const [view, setView] = useState<ProjectsView | null>(null); // Allow null
  const [showSpinner, setShowSpinner] = useState(false);

  useEffect(() => {
    const eventGroup = {};

    // Switch main window size
    ipcRenderer.send('main-window-resize', { size: 'editor', center: true });

    const instance = new ProjectsView({ from });
    instance.render();

    setView(instance);

    instance.on(
      'projectLoaded',
      (project: ProjectModel) => {
        LocalProjectsModel.instance.setCurrentGlobalGitAuth(project.id);
        route.router.route({ to: 'editor', project });
      },
      eventGroup
    );

    EventDispatcher.instance.on(
      'importFromUrl',
      (url: string) => {
        instance.importFromUrl(url);
      },
      eventGroup
    );

    return function () {
      EventDispatcher.instance.off(eventGroup);
      instance?.off(eventGroup);
      instance?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <BaseWindow title="">
      <Fragment>
        {/* Main content */}
        <div style={{ position: 'relative', flex: 1 }}>
          <Frame instance={view} isAbsolute />
        </div>
      </Fragment>
    </BaseWindow>
  );
}

interface TopBarProps {
  showSpinner: boolean;
  setShowSpinner: (value: boolean) => void;
}

function TopBar({ showSpinner, setShowSpinner }: TopBarProps) {
  const { user, signOut, loading: authLoading } = useAuth();
  const [isUserMenuVisible, setIsUserMenuVisible] = useState(false);
  const userMenuTrigger = useRef<HTMLDivElement>(null);

  const handleLogout = async () => {
    try {
      await signOut();
      console.log('User logged out successfully');
      setIsUserMenuVisible(false);
    } catch (error: any) {
      console.error('Logout failed:', error);
    }
  };

  return (
    <div
      style={{
        height: '64px', // Slightly taller for better proportions
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'space-between',
        backgroundColor: 'var(--theme-color-bg-2)',
        borderBottom: '1px solid var(--theme-color-border-1)',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)' // Subtle shadow for depth
      }}
    >
      <HStack
        UNSAFE_style={{
          alignItems: 'center',
          height: '100%'
        }}
        hasSpacing={8} // Increased spacing
      >
        <Logo
          size={LogoSize.Large}
          UNSAFE_style={{
            marginLeft: '32px'
          }}
        />
        <div
          style={{
            height: '24px',
            width: '1px',
            backgroundColor: 'var(--theme-color-border-2)',
            opacity: 0.3
          }}
        />
        <TextButton label="Docs" onClick={() => platform.openExternal(getDocsEndpoint())} />
        <TextButton label="Community" onClick={() => platform.openExternal('https://discord.com/invite/n4P5zkpvFE')} />
      </HStack>

      {/* User Menu Section */}
      <HStack
        UNSAFE_style={{
          alignItems: 'center',
          height: '100%',
          marginRight: '32px'
        }}
        hasSpacing={8} // Reduced spacing to bring elements closer
      >
        {user ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px', // Small gap between user card and menu button
              padding: '4px',
              backgroundColor: 'rgba(255, 255, 255, 0.04)',
              borderRadius: '24px',
              border: '1px solid rgba(255, 255, 255, 0.08)'
            }}
          >
            {/* User Display Card with Membership */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '6px 14px',
                backgroundColor: 'rgba(255, 255, 255, 0.06)',
                borderRadius: '20px',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                transition: 'all 0.2s ease'
              }}
            >
              {/* Status Indicator */}
              <div
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  backgroundColor: '#00D564',
                  boxShadow: '0 0 6px rgba(0, 213, 100, 0.6)',
                  flexShrink: 0
                }}
              />

              {/* User Info */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '1px'
                }}
              >
                {/* User Name */}
                <span
                  style={{
                    color: 'rgba(255, 255, 255, 0.9)',
                    fontSize: '13px',
                    fontWeight: '500',
                    letterSpacing: '0.2px',
                    lineHeight: '1.2'
                  }}
                >
                  {getUserDisplayName(user)}
                </span>

                {/* Membership Level */}
                <span
                  style={{
                    color: 'rgba(255, 255, 255, 0.6)',
                    fontSize: '10px',
                    fontWeight: '500',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    lineHeight: '1.2'
                  }}
                >
                  Alpha
                </span>
              </div>
            </div>

            {/* User Menu Button */}
            <div
              ref={userMenuTrigger}
              style={{
                position: 'relative'
              }}
            >
              <Tooltip content="Account settings">
                <div
                  onClick={() => setIsUserMenuVisible(true)}
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    backgroundColor: 'rgba(255, 255, 255, 0.08)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.12)';
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                    e.currentTarget.style.transform = 'scale(1.05)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)';
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)';
                    e.currentTarget.style.transform = 'scale(1)';
                  }}
                >
                  <Icon
                    icon={IconName.User}
                    UNSAFE_style={{
                      color: 'rgba(255, 255, 255, 0.8)',
                      fontSize: '14px'
                    }}
                  />
                </div>
              </Tooltip>
            </div>

            {/* User Menu Dialog */}
            <MenuDialog
              title="Account"
              isVisible={isUserMenuVisible}
              onClose={() => setIsUserMenuVisible(false)}
              triggerRef={userMenuTrigger}
              items={[
                {
                  label: user.email || 'No email',
                  icon: IconName.User,
                  isDisabled: true
                },
                {
                  label: 'Alpha',
                  isDisabled: true
                },
                {
                  label: 'Sign Out',
                  icon: IconName.ExternalLink,
                  onClick: handleLogout
                }
              ]}
              width={MenuDialogWidth.Small}
            />
          </div>
        ) : (
          <div
            style={{
              color: 'rgba(255, 255, 255, 0.6)',
              fontSize: '13px',
              padding: '6px 12px',
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              borderRadius: '20px',
              border: '1px solid rgba(255, 255, 255, 0.1)'
            }}
          >
            Not signed in
          </div>
        )}
      </HStack>
    </div>
  );
}
