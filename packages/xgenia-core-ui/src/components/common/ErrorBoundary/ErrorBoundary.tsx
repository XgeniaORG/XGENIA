// @xgenia-core-ui/components/common/ErrorBoundary.tsx
import React, { Component, ErrorInfo, ReactNode, Fragment } from 'react';

import {
    PrimaryButton,
    PrimaryButtonSize,
    PrimaryButtonVariant
} from '@xgenia-core-ui/components/inputs/PrimaryButton';
import { Box } from '@xgenia-core-ui/components/layout/Box';
import { Collapsible } from '@xgenia-core-ui/components/layout/Collapsible';
import { HStack } from '@xgenia-core-ui/components/layout/Stack';
import { Label, LabelSize } from '@xgenia-core-ui/components/typography/Label';
import { Text } from '@xgenia-core-ui/components/typography/Text';

import css from './ErrorBoundary.module.scss';

export interface ErrorBoundaryProps {
    showTryAgain?: boolean;
    onTryAgain?: () => void;
    hideErrorStack?: boolean;
    hideCopyError?: boolean;
    children?: ReactNode;
}

// Using a class component
export class ErrorBoundary extends Component<
    ErrorBoundaryProps,
    { error: Error | null; errorInfo: ErrorInfo | null; showMore: boolean }
> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { error: null, errorInfo: null, showMore: false };
    }

    static getDerivedStateFromError(error: Error): { error: Error | null; errorInfo: ErrorInfo | null; showMore: boolean } {
        return { error, errorInfo: null, showMore: false };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
        this.setState({ error, errorInfo });

        // Log the message and the stacks as plain strings. Passing the Error object
        // directly makes Chrome render it as a collapsed frame list, which hides the
        // actual message in copied console output.
        console.error(
            'Error caught by ErrorBoundary: ' + (error?.message || String(error)) +
            '\n\nStack:\n' + (error?.stack || '(no stack)') +
            '\n\nComponent stack:' + (errorInfo?.componentStack || ' (none)')
        );
    }

    private onTryAgain = (): void => {
        // Reset our own state, otherwise the fallback UI sticks around forever and
        // the button does nothing at all.
        this.setState({ error: null, errorInfo: null, showMore: false });
        this.props.onTryAgain && this.props.onTryAgain();
    };

    render() {
        if (this.state.errorInfo) {
            const onCopyError = () => {
                navigator.clipboard.writeText(
                    [
                        this.state.error?.toString() || 'Unknown error',
                        '',
                        'Stack:',
                        this.state.error?.stack || '(no stack)',
                        '',
                        'Component stack:',
                        this.state.errorInfo?.componentStack || '(none)'
                    ].join('\n')
                );
            };

            return (
                <Fragment> {/* Wrap the entire fallback UI in a Fragment */}
                    <div className={css.Root}>
                        <div className={css.Center}>
                            <Box
                                hasXSpacing
                                UNSAFE_style={{ width: '100%', boxSizing: 'border-box' }}
                            >
                                <Label size={LabelSize.Big} hasBottomSpacing>
                                    Aw, Snap!
                                </Label>
                                <Text>Something happened.</Text>
                                {this.props.showTryAgain && (
                                    <Box hasTopSpacing>
                                        <HStack hasSpacing>
                                            <Box>
                                                <PrimaryButton
                                                    size={PrimaryButtonSize.Small}
                                                    label="Click here to try again"
                                                    onClick={this.onTryAgain}
                                                />
                                            </Box>
                                        </HStack>
                                    </Box>
                                )}
                            </Box>
                        </div>

                        {!this.props.hideCopyError && (
                            <div style={{ position: 'absolute', bottom: 0, width: '100%' }}>
                                <div
                                    style={{
                                        background: 'var(--theme-color-bg-2)',
                                        borderTop: '1px solid var(--theme-color-bg-1)'
                                    }}
                                >
                                    <div className={css.Container}>
                                        <Collapsible isCollapsed={!this.state.showMore}>
                                            <pre>
                                                <span className={css.Error}>
                                                    {this.state.error?.toString()}
                                                </span>
                                                <span>{'\n' + (this.state.error?.stack || '')}</span>
                                                <span>{this.state.errorInfo?.componentStack}</span>
                                            </pre>
                                        </Collapsible>
                                    </div>
                                </div>
                                <div className={css.Container}>
                                    <HStack hasSpacing>
                                        {!this.props.hideErrorStack && (
                                            <Box>
                                                <PrimaryButton
                                                    variant={PrimaryButtonVariant.Muted}
                                                    size={PrimaryButtonSize.Small}
                                                    label="More info"
                                                    onClick={() =>
                                                        this.setState((prev) => ({ showMore: !prev.showMore }))
                                                    }
                                                    hasBottomSpacing
                                                />
                                            </Box>
                                        )}
                                        <Box>
                                            <PrimaryButton
                                                variant={PrimaryButtonVariant.Ghost}
                                                size={PrimaryButtonSize.Small}
                                                label="Copy Error Message"
                                                onClick={onCopyError}
                                            />
                                        </Box>
                                    </HStack>
                                </div>
                            </div>
                        )}
                    </div>
                </Fragment>
            );
        }
        return <Fragment>{this.props.children}</Fragment>; // Use Fragment here too
    }
}
