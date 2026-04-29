import _ from 'underscore';
import React from 'react';
import ReactDOM from 'react-dom';
import { createRoot } from 'react-dom/client';

import { Comment, CommentsModel } from '@xgenia-models/commentsmodel';
import KeyboardHandler from '@xgenia-utils/keyboardhandler';

import { pointInsideRectangle, rectanglesOverlap } from '../utils/utils';
import * as CommentLayerView from './CommentLayer/CommentLayerView';
import { NodeGraphEditor } from './nodegrapheditor';

function arrayShallowEqual(a: any[], b: any[]) {
    return a.length === b.length && a.every((value, index) => value === b[index]);
}

export default class CommentLayer {
    nodegraphEditor: NodeGraphEditor;
    props: {
        readOnly: boolean;
        scale: number;
        comments: Comment[];
        selectedIds: string[];
        showTextArea: boolean;
        activeCommentId: string | null;
        isContextOpen: boolean;
        setIsContextOpen: (state: boolean) => void;
        updateComment: (commentId: string, updatedData: any, args: any) => void;
        removeComment: (commentId: string) => void;
        onResizeStart: () => void;
        onResizeStop: () => void;
        setActiveState: (id: string, active: boolean) => void;
        toggleSelection: (id: string) => void;
        setShowTextArea: (show: boolean) => void;
    };
    model: CommentsModel;
    backgroundDiv: HTMLDivElement;
    foregroundDiv: HTMLDivElement;
    // Store React roots for our two layers
    private backgroundRoot: ReturnType<typeof createRoot> | null = null;
    private foregroundRoot: ReturnType<typeof createRoot> | null = null;
    activeCommentId: string;

    constructor(nodegraphEditor: NodeGraphEditor) {
        this.nodegraphEditor = nodegraphEditor;
        this.props = {
            readOnly: false,
            scale: 1,
            comments: [],
            selectedIds: [],
            showTextArea: false,
            activeCommentId: null,
            isContextOpen: false,
            setIsContextOpen: (state: boolean) => {
                this.props.isContextOpen = state;
                this._renderReact();
            },
            updateComment: (commentId, updatedData, args) => {
                const index = this.props.comments.findIndex((c) => c.id === commentId);
                const currentComment = this.props.comments[index];
                const updatedComment = { ...currentComment, ...updatedData };
                this.props.comments[index] = updatedComment;
                this._renderReact();
                if (args && args.commit) {
                    this.model.setComment(commentId, updatedComment, {
                        undo: true,
                        label: args.label || 'change comment'
                    });
                }
            },
            removeComment: (commentId) => {
                this.model.removeComment(commentId, { undo: true, label: 'delete comment' });
            },
            onResizeStart: () => {
                this.nodegraphEditor.setMouseEventsEnabled(false);
                this.nodegraphEditor.clearSelection();
                this.nodegraphEditor.relayout();
                this.nodegraphEditor.repaint();
            },
            onResizeStop: () => {
                this.nodegraphEditor.setMouseEventsEnabled(true);
            },
            setActiveState: (id, active) => {
                if (this.props.activeCommentId === id && active === false) {
                    this.props.activeCommentId = null;
                    this._renderReact();
                } else if (this.props.activeCommentId !== id && active) {
                    this._setActiveComment(id);
                }
            },
            toggleSelection: (id) => {
                const index = this.props.selectedIds.indexOf(id);
                if (index === -1) {
                    this.props.selectedIds.push(id);
                } else {
                    this.props.selectedIds.splice(index, 1);
                }
                this._renderReact();
            },
            setShowTextArea: (show: boolean) => {
                if (this.props.showTextArea === show) return;
                this.props.showTextArea = show;
                this._renderReact();
            }
        };
    }

    setComponentModel(model: any) {
        if (this.model) {
            this.model.off(this);
        }
        if (!model) {
            this.props.comments = [];
            this.clearSelection();
            return;
        }
        const commentModel = model.graph.commentsModel;
        this.model = commentModel;
        this.props.comments = commentModel.getComments();
        commentModel.on(
            'commentsChanged',
            () => {
                this.props.comments = commentModel.getComments();
                this._renderReact();
            },
            this
        );
        this._renderReact();
    }

    _renderReact() {
        if (!this.backgroundDiv || !this.foregroundDiv) {
            return;
        }
        // Create or update the background component
        if (!this.backgroundRoot) {
            this.backgroundRoot = createRoot(this.backgroundDiv);
        }
        this.backgroundRoot.render(
            React.createElement(CommentLayerView.Background, this.props)
        );

        // Create or update the foreground component
        if (!this.foregroundRoot) {
            this.foregroundRoot = createRoot(this.foregroundDiv);
        }
        this.foregroundRoot.render(
            React.createElement(CommentLayerView.Foreground, this.props)
        );
    }

    renderTo(backgroundDiv: HTMLElement, foregroundDiv: HTMLElement) {
        // Ensure that the provided elements are HTMLDivElements
        this.backgroundDiv = backgroundDiv as HTMLDivElement;
        this.foregroundDiv = foregroundDiv as HTMLDivElement;

        this.disposeReactRoots();

        // (Legacy unmount calls removed)

        this.setupMouseEventHandling(this.foregroundDiv);

        // Delay rendering slightly, then render React components
        setTimeout(() => {
          this._renderReact();
        }, 1);
      }

    private disposeReactRoots() {
        if (this.backgroundRoot) {
            this.backgroundRoot.unmount();
            this.backgroundRoot = null;
        }
        if (this.foregroundRoot) {
            this.foregroundRoot.unmount();
            this.foregroundRoot = null;
        }
    }

    // renderTo(backgroundDiv: HTMLElement, foregroundDiv: HTMLElement) {
    //     // Ensure that the provided elements are HTMLDivElements
    //     this.backgroundDiv = backgroundDiv as HTMLDivElement;
    //     this.foregroundDiv = foregroundDiv as HTMLDivElement;

    //     // Unmount any existing roots
    //     if (this.backgroundRoot) {
    //         this.backgroundRoot.unmount();
    //         this.backgroundRoot = null;
    //     }
    //     if (this.foregroundRoot) {
    //         this.foregroundRoot.unmount();
    //         this.foregroundRoot = null;
    //     }

    //     // Fallback: If any legacy ReactDOM.render calls remain, unmount them.
    //     ReactDOM.unmountComponentAtNode(this.backgroundDiv);
    //     ReactDOM.unmountComponentAtNode(this.foregroundDiv);

    //     this.setupMouseEventHandling(this.foregroundDiv);

    //     // Delay rendering slightly, as before
    //     setTimeout(() => {
    //         this._renderReact();
    //     }, 1);
    // }

    hasSelection() {
        return !!this.props.activeCommentId || this.props.selectedIds.length > 0;
    }

    setPanAndScale(panAndScale: { scale: number; x: number; y: number }) {
        if (!this.backgroundDiv || !this.foregroundDiv) return;
        const transform = `scale(${panAndScale.scale}) translate(${panAndScale.x}px, ${panAndScale.y}px)`;
        if (this.backgroundDiv.style.transform !== transform) {
            this.backgroundDiv.style.transform = transform;
            this.foregroundDiv.style.transform = transform;
            if (this.props.scale !== panAndScale.scale) {
                this.props.scale = panAndScale.scale;
                this._renderReact();
            }
        }
    }

    setSelectedCommentIds(ids: string[]) {
        this.props.activeCommentId = null;
        this.props.selectedIds = ids;
        this.props.showTextArea = false;
        this._renderReact();
    }

    getSelectedComments() {
        return this.props.comments.filter((c) => this.props.selectedIds.includes(c.id));
    }

    deleteSelection(args: any) {
        const selectedComments = this.getSelectedComments();
        if (!this.model) return;
        selectedComments.forEach(comment => this.model.removeComment(comment.id, args));

        this.clearSelection();
    }

    clearMultiselection() {
        // Clear all selections except the active one (if any)
        this.props.selectedIds = this.props.selectedIds.filter(
            (id) => id !== this.props.activeCommentId
        );
        this._renderReact();
    }

    clearSelection() {
        this.props.showTextArea = false;
        if (this.props.selectedIds.length) {
            this.props.activeCommentId = null;
            this.props.selectedIds = [];
            this._renderReact();
        }
    }

    _setActiveComment(commentId: string) {
        if (this.props.activeCommentId === commentId) return;

        this.props.selectedIds = [commentId];
        this.props.activeCommentId = commentId;
        this.props.showTextArea = false;
        this.nodegraphEditor.clearSelection();
        this.nodegraphEditor.relayout();
        this.nodegraphEditor.repaint();
        this._renderReact();
    }

    focusComment(commentId: string) {
        this._setActiveComment(commentId);
        this.props.showTextArea = true;
        this._renderReact();
    }

    setReadOnly(readOnly: boolean) {
        this.props.readOnly = readOnly;
        this._renderReact();
    }

    performMultiSelect(selectRect: { x: number; y: number; width: number; height: number }, mode: string) {
        const intersectedComments = this.props.comments.filter((c) =>
            rectanglesOverlap(c, selectRect)
        );
        let commentIds = intersectedComments.map((c) => c.id);
        if (mode === 'union') {
            commentIds = _.union(this.props.selectedIds, commentIds);
        } else if (mode === 'reduce') {
            commentIds = _.difference(this.props.selectedIds, commentIds);
        }
        if (!arrayShallowEqual(this.props.selectedIds, commentIds)) {
            this.props.selectedIds = commentIds;
            this._renderReact();
        }
    }

    moveSelectedComments(dx: number, dy: number) {
        if (this.props.selectedIds.length === 0) return;
        for (const commentId of this.props.selectedIds) {
            const index = this.props.comments.findIndex((c) => c.id === commentId);
            const comment = this.props.comments[index];
            const updatedComment = { ...comment, x: comment.x + dx, y: comment.y + dy };
            this.props.comments[index] = updatedComment;
        }
        this._renderReact();
    }

    commitSelectedComments(args: any) {
        const comments = this.getSelectedComments();
        for (const comment of comments) {
            this.model.setComment(comment.id, comment, args);
        }
    }

    dispose() {
        if (this.foregroundRoot) {
          setTimeout(() => {
            this.foregroundRoot.unmount();
            this.foregroundRoot = null;
          }, 0);
        }
        if (this.backgroundRoot) {
          setTimeout(() => {
            this.backgroundRoot.unmount();
            this.backgroundRoot = null;
          }, 0);
        }

        if (this.foregroundDiv) {
            this.foregroundDiv.replaceWith(this.foregroundDiv.cloneNode(true));
        }
        if (this.model) {
          this.model.off(this);
        }
      }


    setupMouseEventHandling(foregroundDiv: HTMLElement) {
        const events = {
            mousedown: 'down',
            mouseup: 'up',
            mousemove: 'move',
            mouseout: 'out',
            mouseover: 'over',
            click: 'click'
        };

        let ignoreNextClick = false;
        let clickIgnoreTimeout: any;

        for (const eventName in events) {
            const type = events[eventName];
            const eventHandler = (evt: MouseEvent) => {
                    if (evt.target && (evt.target as HTMLElement).closest('.comment-controls')) {
                        // Interacting with comment controls; do not forward.
                        return;
                    }

                    if (ignoreNextClick && type === 'click') {
                        ignoreNextClick = false;
                        evt.stopPropagation();
                        evt.preventDefault();
                        return;
                    }

                    (evt as any).spaceKey = this.nodegraphEditor.spaceKeyDown;
                    const tl = this.nodegraphEditor.topLeftCanvasPos;
                    const pos = {
                        x: evt.pageX - tl[0],
                        y: evt.pageY - tl[1],
                        pageX: evt.pageX,
                        pageY: evt.pageY
                    };

                    const consumed = this.nodegraphEditor.mouse(type, pos, evt as any, {
                        eventPropagatedFromCommentLayer: true
                    });

                    if (consumed) {
                        evt.stopPropagation();
                        evt.preventDefault();
                        if (type === 'down' || type === 'up') {
                            if (clickIgnoreTimeout) clearTimeout(clickIgnoreTimeout);
                            ignoreNextClick = true;
                            clickIgnoreTimeout = setTimeout(() => {
                                ignoreNextClick = false;
                            }, 1000);
                        }
                    } else {
                        const startMultiselectDrag =
                            type === 'down' &&
                            (this.props.selectedIds.length > 1 || this.nodegraphEditor.selector.active);
                        if (startMultiselectDrag) {
                            const ngPos = this.nodegraphEditor.relativeCoordsToNodeGraphCords(pos);
                            const commentUnderCursor = this.props.comments.find((c) =>
                                pointInsideRectangle(ngPos, c)
                            );
                            if (!commentUnderCursor || this.props.selectedIds.includes(commentUnderCursor.id)) {
                                this.nodegraphEditor.startDraggingNodes(this.nodegraphEditor.selector.nodes);
                                evt.stopPropagation();
                                evt.preventDefault();
                            }
                        }
                    }
                };
                foregroundDiv.removeEventListener(eventName, eventHandler);
                foregroundDiv.addEventListener(eventName, eventHandler, true);


        }

        foregroundDiv.addEventListener('wheel', (evt: WheelEvent) => {
            if ((evt.target as HTMLElement).tagName !== 'TEXTAREA' || evt.ctrlKey || evt.metaKey) {
                const tl = this.nodegraphEditor.topLeftCanvasPos;
                this.nodegraphEditor.handleMouseWheelEvent(evt, {
                    offsetX: evt.pageX - tl[0],
                    offsetY: evt.pageY - tl[1]
                });
            }
        });

        foregroundDiv.addEventListener('keydown', (evt: KeyboardEvent) => {
            if ((evt.target as HTMLElement).tagName !== 'TEXTAREA') {
                KeyboardHandler.instance.executeCommandMatchingKeyEvent(evt, 'down');
            }
        });
    }
}
