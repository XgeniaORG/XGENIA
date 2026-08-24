import classNames from 'classnames';
import React, { useState } from 'react';

import { ProjectLibraryModel } from '@xgenia-models/projectlibrarymodel';
import { ProjectItem } from '@xgenia-utils/LocalProjectsModel';
import { resolveThumbSrc } from '@xgenia-utils/thumbnails/thumbnail-store';
import { timeSince } from '@xgenia-utils/utils';

import { ActivityIndicator } from '@xgenia-core-ui/components/common/ActivityIndicator';
import { PrimaryButton } from '@xgenia-core-ui/components/inputs/PrimaryButton';
import { Text } from '@xgenia-core-ui/components/typography/Text';
import { TextType } from '@xgenia-core-ui/components/typography/Text/Text';
import { Title } from '@xgenia-core-ui/components/typography/Title';
import { TitleVariant } from '@xgenia-core-ui/components/typography/Title/Title';

import { useNodePickerContext } from '../../NodePicker.context';
import css from './ProjectCard.module.scss';

enum CardState {
  Idle = 'is-idle',
  Downloading = 'is-downloading',
  Finished = 'is-finished',
  Cancelled = 'is-cancelled'
}
export interface ProjectCardProps {
  project: ProjectItem;
}

export function ProjectCard({ project }: ProjectCardProps) {
  const context = useNodePickerContext();

  const [cardState, setCardState] = useState(CardState.Idle);
  const [cancelMessage, setCancelMessage] = useState('');

  function handleDownload() {
    setCardState(CardState.Downloading);
    ProjectLibraryModel.instance
      .importProject(project, context.doBlockPicker, context.doUnblockPicker)
      .then(() => setCardState(CardState.Finished))
      .catch((error) => {
        setCardState(CardState.Cancelled);
        setCancelMessage(error.message);
      })
      .finally(() => setTimeout(() => setCardState(CardState.Idle), 3000));
  }

  return (
    <article className={classNames(css['Root'], css[cardState])}>
      <div className={css['ImageContainer']}>
        <div className={css['Image']} style={{ backgroundImage: `url(${resolveThumbSrc(project)})` }} />
      </div>

      <div className={css['Content']}>
        <div>
          <header>
            <Title hasBottomSpacing>{project.name}</Title>

            {project.latestAccessed && (
              <Text textType={TextType.Shy}>Last accessed {timeSince(project.latestAccessed)} ago</Text>
            )}
          </header>
        </div>

        <div className={css['HoverOverlay']}>
          <div className={css['CtaContainer']}>
            <PrimaryButton label="Import" onClick={() => handleDownload()} />
          </div>
        </div>

        <div className={css['ImportIndicator']}>
          <Title isCentered hasBottomSpacing>
            Importing module
          </Title>
          <ActivityIndicator />
        </div>

        <div className={css['SuccessToast']}>
          <Title variant={TitleVariant.Success} isCentered hasBottomSpacing>
            Successfully imported
          </Title>
          <Text>{project.name}</Text>
        </div>

        <div className={css['CancelToast']}>
          <Title variant={TitleVariant.Danger} isCentered>
            {cancelMessage}
          </Title>
        </div>
      </div>
    </article>
  );
}
