import React from 'react';
import { createRoot, Root } from 'react-dom/client'; // Import Root

import { App } from '@xgenia-models/app';
import { KeyCode, KeyMod } from '@xgenia-utils/keyboard/KeyCode';
import KeyboardHandler, { KeyboardCommand } from '@xgenia-utils/keyboardhandler';

import { EventDispatcher } from '../../../shared/utils/EventDispatcher';
import evalConditions from './lessons/lessonevalconditions';
import LessonLayerView from './lessons/LessonLayerView';
import PopupLayer from './popuplayer';

interface ILessonStep {
    isComplete: boolean;
    conditions?: any[];

    width?: string;
    itemContent?: HTMLDivElement;
    popupContent: HTMLDivElement;

    error?: string;
    hasNextButton?: boolean;
}

export class LessonLayer {
    keyboardCommands: KeyboardCommand[];
    model: any;
    nextButton: HTMLDivElement;
    div: HTMLDivElement;
    steps: ILessonStep[];
    el: JQuery<HTMLElement>; // Use JQuery<HTMLElement> for consistency
    refreshTimeout: NodeJS.Timeout;
    private _root: Root | null = null; // Use Root type

    constructor() {
        this.keyboardCommands = [
            {
                handler: () => this.reload(),
                keybinding: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_R
            },
            {
                handler: () => this.restart(),
                keybinding: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_T
            },
            {
                handler: () => this.model.next(),
                keybinding: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_N
            }
        ];

        KeyboardHandler.instance.registerCommands(this.keyboardCommands);
    }

    startLesson(model: any) {
        if (this.model) {
            this.dispose();
        }

        this.model = model;

        this.model.on(
            'instructionsChanged',
            () => {
                this.refresh();
            },
            this
        );

        this.model.on(
            'instructionsFetched',
            () => {
                this.loadSteps();
                this.refresh();
            },
            this
        );

        EventDispatcher.instance.on(
            'activeComponentChanged',
            () => {
                this.refresh();
            },
            this
        );

        EventDispatcher.instance.on(
            'viewer-navigated',
            () => {
                this.refresh();
            },
            this
        );

        model.start();

        // When the model changes, refresh the lesson popup
        EventDispatcher.instance.on(
            'Model.*',
            () => {
                clearTimeout(this.refreshTimeout);
                this.refreshTimeout = setTimeout(() => {
                    this.refresh();
                }, 1);
            },
            this
        );

        return this._render();
    }

    _renderReact() {
        const props = {
            steps: this.steps,
            currentStepIndex: this.model.index,
            onMoveToNextStep: () => {
                this.model.next();
            }
        };

        if (!this._root) {
            this._root = createRoot(this.div);
        }
        this._root.render(React.createElement(LessonLayerView, props));
    }

    _render() {
        if (this.div) {
            this.dispose(); // Clean up previous root
        }

        this.div = document.createElement('div');
        this.div.className = 'lessonlayerview';
        this._root = createRoot(this.div); // Create the root here
        this._renderReact();

        this.el = $(this.div); // Assuming you're using jQuery
        return this.el;
    }

    refresh() {
        if (!this.steps) {
            // still waiting for the model to fetch the steps
            return;
        }

        this.steps.forEach((step, stepIndex) => {
            if (stepIndex < this.model.index) {
                step.isComplete = true;
                const nextButton = step.popupContent.querySelector('.popup-button-container');
                if (nextButton) nextButton.parentElement.removeChild(nextButton);
                step.hasNextButton = false;
            } else if (stepIndex === this.model.index) {
                if (step.conditions && step.conditions.length) {
                    try {
                        step.isComplete = evalConditions(step.conditions);
                    } catch (e: any) {
                        console.error('error in lesson condition', step.conditions, e.message);
                        step.error = `Step ${stepIndex}: ${e.message}. Invalid condition: ${JSON.stringify(
                            step.conditions
                        )}.`;
                    }
                } else {
                    step.isComplete = false;
                    // add the next or done button if this isn't a popup-only step
                    if (step.itemContent && step.popupContent) {
                        // (button handling code omitted)
                    }
                }
            } else {
                step.isComplete = false;
            }
        });

        const currentStep = this.steps[this.model.index];

        if (currentStep && currentStep.conditions && currentStep.isComplete) {
            this.model.next();
        } else {
            if (this.div) {
                this._renderReact();
            }
        }
    }

    _onNextClick() {
        PopupLayer.instance.hideModal();
        PopupLayer.instance.hidePopouts(true);
        this.model.next();
    }

    loadSteps() {
        const steps = this.model.lessons.map((instructionsHTML: string, stepIndex: number) => {
            const stepElement = document.createElement('div');
            stepElement.innerHTML = instructionsHTML;

            const itemContent: HTMLDivElement | null = stepElement.querySelector('div[data-template="item"]');
            const popupContent: HTMLDivElement | null = stepElement.querySelector('div[data-template="popup"]');

            const buttons = stepElement.querySelectorAll('[data-click]') as NodeListOf<HTMLElement>;
            for (const button of Array.from(buttons)) {
                const clickAction = button.getAttribute('data-click');
                if (clickAction === 'exitEditor') {
                    button.parentElement.removeChild(button);
                }
            }

            const step: any = {
                hasNextButton: false
            };

            if (itemContent) {
                this._loadImages(itemContent);
                this._loadVideos(itemContent);

                let conditions = stepElement.firstElementChild.getAttribute('data-conditions');
                if (conditions) {
                    try {
                        conditions = JSON.parse(conditions);
                    } catch (e: any) {
                        console.error('error in lesson condition', conditions, e.message);
                        step.error = `Step ${stepIndex}: Invalid condition: ${conditions}. ${e.message}`;
                    }
                }
                step.conditions = conditions && conditions.length ? conditions : undefined;
                if (itemContent.style.width) {
                    step.width = itemContent.style.width;
                    itemContent.style.width = '';
                }
                step.itemContent = itemContent;

                const actions = stepElement.firstElementChild.getAttribute('data-actions');
                if (actions) {
                    try {
                        step.actions = JSON.parse(actions);
                    } catch (e: any) {
                        console.error('error in lesson actions', actions, e.message);
                        step.error = `Step ${stepIndex}: Invalid actions: ${actions}. ${e.message}`;
                    }
                }
            }

            if (popupContent) {
                const root = popupContent.cloneNode() as HTMLDivElement;
                root.innerHTML = '';

                const mediaContainer = document.createElement('div');
                mediaContainer.classList.add('popup-media');
                root.appendChild(mediaContainer);
                const mediaRenderContainer = root.querySelector('.popup-media');

                this._loadImages(popupContent, mediaRenderContainer);
                this._loadVideos(popupContent, mediaRenderContainer);

                const legacyStyleTag = popupContent.querySelector('style');
                if (legacyStyleTag) popupContent.removeChild(legacyStyleTag);

                const contentWrapper = document.createElement('div');
                contentWrapper.classList.add('popup-content-wrapper');
                const contentContainer = document.createElement('div');
                contentContainer.classList.add('popup-content');
                contentContainer.innerHTML = popupContent.innerHTML;
                popupContent.innerHTML = '';

                const shouldButtonRender = !step.conditions;
                const isLastStep = this.model.lessons.length - 1 === stepIndex;

                if (shouldButtonRender || contentContainer.innerHTML.trim().length) {
                    contentWrapper.prepend(contentContainer);
                    root.prepend(contentWrapper);
                }

                if (shouldButtonRender) {
                    const buttonContainer = root.querySelector('.popup-content-wrapper');
                    const buttonToAppend = !isLastStep
                        ? createPopupButton('NEXT', () => {
                            this._onNextClick();
                        })
                        : createPopupButton('EXIT LESSON', () => {
                            App.instance.exitProject();
                        });
                    buttonContainer.appendChild(buttonToAppend);
                    step.hasNextButton = !isLastStep;
                }

                step.popupContent = root;
            }

            return step;
        });

        this.steps = steps.filter((step) => step.itemContent || step.popupContent);
    }

    reload() {
        dataurls = {}; // Reload images, reset cache
        this.model.start();
    }

    restart() {
        this.model.index = 0;
        this.model.start();
    }
    dispose() {
        clearTimeout(this.refreshTimeout);
        KeyboardHandler.instance.deregisterCommands(this.keyboardCommands);

        this.model.off(this);
        EventDispatcher.instance.off(this);

        if (this._root) {
            this._root.unmount(); // Use the unmount method of the root
            this._root = null;
        }
        if(this.div) {
            this.div.remove()
        }
    }

    resize()
    {// TODO: Implement resize logic
        }

    _loadImages(el: any, renderContainer: any = undefined) {
        // OLD (Incorrect):
        // const _this = this;
        // $(el)
        //     .find('img')
        //     .each(function () {
        //         const _el = $(this);
        //         const url = _el.attr('src');
        //         loadSrcAsset(_el, _this.model.baseURL + url, 'image/*', renderContainer);
        //     });

        // NEW (Correct - using arrow function):
        $(el)
            .find('img')
            .each((index, element) => { // Use an arrow function here
                const _el = $(element);
                const url = _el.attr('src');
                loadSrcAsset(_el, this.model.baseURL + url, 'image/*', renderContainer); // Use this directly
            });
    }

    _loadVideos(el: any, renderContainer: any = undefined) {
        // OLD (Incorrect):
        // const _this = this;
        // $(el)
        //    .find('video')
        //    .each(function () {
        //        const _el = $(this);
        //        const url = _el.attr('src');
        //        _el.removeAttr('autoplay');
        //        _el.attr('loop', '');
        //        _el.attr('muted', '');
        //        loadSrcAsset(_el, _this.model.baseURL + url, 'video/*', renderContainer);
        //    });

        // NEW (Correct - using arrow function):
        $(el)
            .find('video')
            .each((index, element) => { // Use an arrow function here
                const _el = $(element);
                const url = _el.attr('src');
                _el.removeAttr('autoplay');
                _el.attr('loop', '');
                _el.attr('muted', '');
                loadSrcAsset(_el, this.model.baseURL + url, 'video/*', renderContainer); // Use this directly
            });
    }
}

let dataurls = {};

function loadSrcAsset(el: any, url: string, acceptType: string, renderContainer: any) {
    el.addClass('unselectable');
    const _hash = url;
    if (dataurls[_hash]) {
        el.attr('src', dataurls[_hash]);
        if (renderContainer) {
            renderContainer.append(el[0]);
        }
    } else {
        el.attr('src', '');
        const spinner = $(
            '<div class="spinner lesson-spinner"><div class="bounce1"></div><div class="bounce2"></div><div class="bounce3"></div></div>'
        );
        if (renderContainer) {
            el.replaceWith('');
            renderContainer.appendChild(spinner[0]);
        } else {
            el.replaceWith(spinner);
        }
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.setRequestHeader('Accept', acceptType);
        xhr.responseType = 'blob';
        xhr.onload = function () {
            const dataurl = window.URL.createObjectURL(this.response);
            dataurls[_hash] = dataurl;
            el.attr('src', dataurl);
            if (renderContainer) {
                const spinners = Array.from(renderContainer.querySelectorAll('.lesson-spinner'));
                spinners.forEach((spinner) => {
                    renderContainer.removeChild(spinner);
                });
                renderContainer.append(el[0]);
            } else {
                spinner.replaceWith(el);
            }
        };
        xhr.send();
    }
}

function createPopupButton(label: string, onClick: () => void) {
    const div = document.createElement('div');
    div.style.display = 'flex';
    div.style.justifyContent = 'flex-end';
    div.classList.add('popup-button-container');

    const button = document.createElement('button');
    button.className = 'lesson-next-button';
    button.innerText = label;
    button.onclick = onClick;
    div.appendChild(button);
    return div;
}
