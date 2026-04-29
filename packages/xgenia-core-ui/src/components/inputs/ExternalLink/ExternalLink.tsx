import React from 'react';
import css from './ExternalLink.module.scss';
import { platform } from '@xgenia/platform';
import useParsedHref from '@xgenia-hooks/useParsedHref';
import classNames from 'classnames';
import { Slot, UnsafeStyleProps } from '@xgenia-core-ui/types/global';
import { Icon, IconName, IconSize } from '@xgenia-core-ui/components/common/Icon';

export interface ExternalLinkProps extends UnsafeStyleProps {
   children: ReactNode;
  href: string;
  testId?: string;
}

export function ExternalLink({
  children,
  href,
  testId,
  UNSAFE_className,
  UNSAFE_style
}: ExternalLinkProps) {
  const parsedHref = useParsedHref(href);
  function handleClick() {
    platform.openExternal(parsedHref);
  }

  return (
    <a
      className={classNames(css['Root'], UNSAFE_className)}
      onClick={handleClick}
      target="_blank"
      data-test={testId}
      style={UNSAFE_style}
    >
      {children}
      <Icon UNSAFE_className={css['Icon']} icon={IconName.ExternalLink} size={IconSize.Tiny} />
    </a>
  );
}
