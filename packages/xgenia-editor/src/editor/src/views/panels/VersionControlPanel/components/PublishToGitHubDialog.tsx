import React, { useEffect, useRef, useState } from 'react';
import { Git } from '@xgenia/git';
import { platform } from '@xgenia/platform';

import { FeedbackType } from '@xgenia-constants/FeedbackType';

import { Icon, IconName, IconSize } from '@xgenia-core-ui/components/common/Icon';
import { PrimaryButton, PrimaryButtonVariant } from '@xgenia-core-ui/components/inputs/PrimaryButton';
import { Select, SelectOption } from '@xgenia-core-ui/components/inputs/Select';
import { TextButton } from '@xgenia-core-ui/components/inputs/TextButton';
import { TextInput, TextInputVariant } from '@xgenia-core-ui/components/inputs/TextInput';
import { Box } from '@xgenia-core-ui/components/layout/Box';
import { Container } from '@xgenia-core-ui/components/layout/Container';
import { Modal } from '@xgenia-core-ui/components/layout/Modal';
import { VStack } from '@xgenia-core-ui/components/layout/Stack';
import { Label } from '@xgenia-core-ui/components/typography/Label';
import { Text, TextType } from '@xgenia-core-ui/components/typography/Text';
import {
  getAuthenticatedUser,
  getOrganizations,
  GitHubOwner,
  GitHubRepository,
  GitHubUser
} from '@xgenia-services/GitHubApi';

import { getGitHubRepoUrl, suggestRepositoryName } from '../github';
import { GITHUB_PAT_DOCS_URL, loadStoredGitHubToken, signInToGitHub } from '../githubAuth';
import { publishToGitHub } from '../publishToGitHub';

const VISIBILITY_OPTIONS: SelectOption<string>[] = [
  { label: 'Private repository', value: 'private' },
  { label: 'Public repository', value: 'public' }
];

export interface PublishToGitHubDialogProps {
  isVisible: boolean;
  git: Git;
  projectId: string;
  projectName: string;
  onClose: () => void;
  /** Called after a successful publish, so the panel can refresh its git state. */
  onPublished: (repository: GitHubRepository) => void;
}

type Phase = 'signIn' | 'details' | 'publishing' | 'published';

export function PublishToGitHubDialog({
  isVisible,
  git,
  projectId,
  projectName,
  onClose,
  onPublished
}: PublishToGitHubDialogProps) {
  const [phase, setPhase] = useState<Phase>('signIn');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState('');
  const [progressLabel, setProgressLabel] = useState('');

  const [token, setToken] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [user, setUser] = useState<GitHubUser>(null);
  const [owners, setOwners] = useState<GitHubOwner[]>([]);
  const [ownerLogin, setOwnerLogin] = useState('');

  const [repositoryName, setRepositoryName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState('private');

  const [repository, setRepository] = useState<GitHubRepository>(null);

  // The remote that publishing will overwrite, if the project already has one.
  const existingRemoteUrl = git.OriginUrl;

  // Guards the async token check below from writing state into a closed dialog.
  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isVisible) return;

    // Start from a clean slate every time the dialog opens.
    setPhase('signIn');
    setError('');
    setProgressLabel('');
    setRepository(null);
    setTokenInput('');
    setRepositoryName(suggestRepositoryName(projectName));
    setDescription('');
    setVisibility('private');

    (async () => {
      setIsBusy(true);
      const storedToken = await loadStoredGitHubToken(projectId);
      if (!isMounted.current) return;

      if (storedToken) {
        // Don't take a stored token at face value: it may have been revoked or
        // expired since the last push.
        const accepted = await verifyToken(storedToken, { silentOnFailure: true });
        if (!accepted && isMounted.current) {
          setTokenInput('');
        }
      }

      if (isMounted.current) setIsBusy(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible]);

  /** Verify a token, load the accounts it can publish to, and move on. */
  async function verifyToken(candidate: string, options?: { silentOnFailure?: boolean }): Promise<boolean> {
    try {
      const githubUser = await getAuthenticatedUser(candidate);
      const organizations = await getOrganizations(candidate);
      if (!isMounted.current) return false;

      setToken(candidate);
      setUser(githubUser);
      setOwners([{ login: githubUser.login, isOrganization: false }, ...organizations]);
      setOwnerLogin(githubUser.login);
      setError('');
      setPhase('details');
      return true;
    } catch (e: any) {
      if (!isMounted.current) return false;
      if (!options?.silentOnFailure) {
        setError(e?.message || 'Could not verify the token.');
      }
      setPhase('signIn');
      return false;
    }
  }

  async function onContinueWithToken() {
    const candidate = tokenInput.trim();
    if (!candidate) {
      setError('Paste a personal access token to continue.');
      return;
    }

    setIsBusy(true);
    setError('');
    await verifyToken(candidate);
    if (isMounted.current) setIsBusy(false);
  }

  async function onSignInWithGitHub() {
    setIsBusy(true);
    setError('');

    try {
      const oauthToken = await signInToGitHub();
      await verifyToken(oauthToken);
    } catch (e: any) {
      if (isMounted.current) {
        setError(
          (e?.message || 'Could not sign in to GitHub.') + ' You can paste a personal access token instead.'
        );
      }
    }

    if (isMounted.current) setIsBusy(false);
  }

  async function onPublish() {
    const name = repositoryName.trim();
    if (!name) {
      setError('Enter a name for the repository.');
      return;
    }

    const owner = owners.find((x) => x.login === ownerLogin);

    setPhase('publishing');
    setError('');

    try {
      const created = await publishToGitHub({
        git,
        projectId,
        token,
        user,
        organization: owner?.isOrganization ? owner.login : undefined,
        repositoryName: name,
        description: description.trim(),
        isPrivate: visibility === 'private',
        onProgress: (label, percent) => {
          if (!isMounted.current) return;
          setProgressLabel(typeof percent === 'number' ? `${label} (${Math.ceil(percent * 100)}%)` : label);
        }
      });

      if (!isMounted.current) return;

      setRepository(created);
      setPhase('published');
      onPublished(created);
    } catch (e: any) {
      if (!isMounted.current) return;
      console.error('[PublishToGitHubDialog] Publish failed:', e);
      setError(e?.message || String(e));
      setPhase('details');
    }
  }

  const footerSlot = (() => {
    switch (phase) {
      case 'signIn':
        return (
          <Container UNSAFE_style={{ justifyContent: 'flex-end', gap: '8px' }}>
            <PrimaryButton label="Cancel" variant={PrimaryButtonVariant.Muted} onClick={onClose} />
            <PrimaryButton label="Continue" isDisabled={isBusy} isLoading={isBusy} onClick={onContinueWithToken} />
          </Container>
        );

      case 'details':
      case 'publishing':
        return (
          <Container UNSAFE_style={{ justifyContent: 'flex-end', gap: '8px' }}>
            <PrimaryButton
              label="Cancel"
              variant={PrimaryButtonVariant.Muted}
              isDisabled={phase === 'publishing'}
              onClick={onClose}
            />
            <PrimaryButton
              label={phase === 'publishing' ? progressLabel || 'Publishing…' : 'Publish repository'}
              isDisabled={phase === 'publishing'}
              isLoading={phase === 'publishing'}
              onClick={onPublish}
            />
          </Container>
        );

      case 'published':
        return (
          <Container UNSAFE_style={{ justifyContent: 'flex-end', gap: '8px' }}>
            <PrimaryButton
              label="Open on GitHub"
              variant={PrimaryButtonVariant.Muted}
              onClick={() => {
                const url = repository?.htmlUrl || getGitHubRepoUrl(git.OriginUrl);
                if (url) platform.openExternal(url);
              }}
            />
            <PrimaryButton label="Done" onClick={onClose} />
          </Container>
        );
    }
  })();

  return (
    <Modal
      isVisible={isVisible}
      title="Publish to GitHub"
      subtitle={phase === 'published' ? 'Your project is on GitHub' : 'Create a repository and push this project to it'}
      hasHeaderDivider
      hasFooterDivider
      footerSlot={footerSlot}
      onClose={phase === 'publishing' ? undefined : onClose}
    >
      <VStack UNSAFE_style={{ width: 'min(460px, 100%)' }}>
        {phase === 'signIn' && (
          <>
            <Text hasBottomSpacing>
              Sign in to GitHub to create the repository. XGENIA stores the token encrypted with this project and uses
              it for every push and pull.
            </Text>

            <PrimaryButton
              label="Sign in with GitHub"
              icon={IconName.ExternalLink}
              isDisabled={isBusy}
              hasBottomSpacing
              isGrowing
              onClick={onSignInWithGitHub}
            />

            <Label hasBottomSpacing variant={TextType.Shy}>
              Or use a personal access token
            </Label>

            <TextInput
              label="Personal Access Token"
              type="password"
              value={tokenInput}
              variant={TextInputVariant.InModal}
              hasBottomSpacing
              isAutoFocus
              onChange={(ev) => setTokenInput(ev.target.value)}
              onEnter={onContinueWithToken}
            />

            <Box hasBottomSpacing>
              <TextButton
                label="How to create a personal access token"
                onClick={() => platform.openExternal(GITHUB_PAT_DOCS_URL)}
              />
            </Box>
            <Text hasBottomSpacing textType={TextType.Shy}>
              The token needs the repo scope so it can create the repository and push to it.
            </Text>
          </>
        )}

        {(phase === 'details' || phase === 'publishing') && (
          <>
            <Container hasBottomSpacing UNSAFE_style={{ alignItems: 'center', gap: '8px' }}>
              <Text>
                Signed in as{' '}
                <Text textType={TextType.Proud} isSpan>
                  {user?.login}
                </Text>
              </Text>
              <TextButton
                label="Use another account"
                onClick={() => {
                  setPhase('signIn');
                  setTokenInput('');
                  setError('');
                }}
              />
            </Container>

            <Select
              label="Owner"
              options={owners.map((owner) => ({
                label: owner.isOrganization ? `${owner.login} (organization)` : owner.login,
                value: owner.login
              }))}
              value={ownerLogin}
              hasBottomSpacing
              isDisabled={phase === 'publishing'}
              onChange={(value) => setOwnerLogin(String(value))}
            />

            <TextInput
              label="Repository name"
              value={repositoryName}
              variant={TextInputVariant.InModal}
              hasBottomSpacing
              isDisabled={phase === 'publishing'}
              onChange={(ev) => setRepositoryName(suggestRepositoryName(ev.target.value))}
            />

            <TextInput
              label="Description (optional)"
              value={description}
              variant={TextInputVariant.InModal}
              hasBottomSpacing
              isDisabled={phase === 'publishing'}
              onChange={(ev) => setDescription(ev.target.value)}
            />

            <Select
              label="Visibility"
              options={VISIBILITY_OPTIONS}
              value={visibility}
              hasBottomSpacing
              isDisabled={phase === 'publishing'}
              onChange={(value) => setVisibility(String(value))}
            />

            {Boolean(existingRemoteUrl) && (
              <Container hasBottomSpacing UNSAFE_style={{ alignItems: 'center', gap: '8px' }}>
                <Icon
                  icon={IconName.WarningTriangle}
                  size={IconSize.Default}
                  variant={FeedbackType.Notice}
                  UNSAFE_style={{ flexShrink: 0 }}
                />
                <Text>
                  This project already points at {existingRemoteUrl}. Publishing replaces that remote with the new
                  repository.
                </Text>
              </Container>
            )}
          </>
        )}

        {phase === 'published' && (
          <>
            <Container hasBottomSpacing UNSAFE_style={{ alignItems: 'center', gap: '8px' }}>
              <Icon
                icon={IconName.CloudCheck}
                size={IconSize.Default}
                variant={FeedbackType.Success}
                UNSAFE_style={{ flexShrink: 0 }}
              />
              <Text>
                Published to{' '}
                <Text textType={TextType.Proud} isSpan>
                  {repository?.fullName}
                </Text>
                .
              </Text>
            </Container>
            <Text>
              The {repository?.isPrivate ? 'private' : 'public'} repository is now the remote for this project, so
              commits can be pushed and pulled straight from this panel.
            </Text>
          </>
        )}

        {Boolean(error) && (
          <Container UNSAFE_style={{ alignItems: 'center', gap: '8px' }}>
            <Icon
              icon={IconName.WarningTriangle}
              size={IconSize.Default}
              variant={FeedbackType.Danger}
              UNSAFE_style={{ flexShrink: 0 }}
            />
            <Text textType={FeedbackType.Danger}>{error}</Text>
          </Container>
        )}
      </VStack>
    </Modal>
  );
}
