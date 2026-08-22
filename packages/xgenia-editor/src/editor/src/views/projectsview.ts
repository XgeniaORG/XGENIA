import { filesystem, platform } from '@xgenia/platform';

import { DialogLayerModel } from '@xgenia-models/DialogLayerModel';
import { LessonsProjectsModel } from '@xgenia-models/LessonsProjectModel';
import { CloudServiceMetadata } from '@xgenia-models/projectmodel';
import { setCloudServices } from '@xgenia-models/projectmodel.editor';
import { LocalProjectsModel, ProjectItem } from '@xgenia-utils/LocalProjectsModel';

import { SidebarModel } from '@xgenia-models/sidebar/sidebarmodel';
import View from '../../../shared/view';
import LessonTemplatesModel from '../models/lessontemplatesmodel';
import TutorialsModel from '../models/tutorialsmodel';
import { supabase, signOut as supabaseSignOut } from '../supabaseInit';
import CloudFormation from '../utils/cloudformation';
import { templateRegistry } from '../utils/forge';
import { tracker } from '../utils/tracker';
import { getUserProfile } from '../utils/userUtils';
import { timeSince } from '../utils/utils';
import { ChatPanelIframe_ID } from './panels/ChatPanelBridge/ChatPanelIframe';
import { editorBridge } from './panels/ChatPanelBridge/EditorBridge';
import { getLessonsState } from './projectsview.lessonstate';
import { ToastLayer } from './ToastLayer/ToastLayer';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ProjectsViewTemplate = require('../templates/projectsview.html');

// Styles
require('../styles/projectsview.css');
require('../styles/projectsview.lessoncards.css');

const _cache = {};

type ProjectItemScope = {
  project: ProjectItem;
  label: string;
  latestAccessedTimeAgo: string;
};

export class ProjectsView extends View {
  _popupLayerElem = null;
  lessonTemplatesModel: LessonTemplatesModel;
  lessonProjectsModel: LessonsProjectsModel;
  projectsModel: LocalProjectsModel;
  tutorialsModel: TutorialsModel;
  from: TSFixme;

  private _backgroundUpdateTimeout: TSFixme;
  private _backgroundUpdateListener: () => void;
  selectedTutorialCategory: TSFixme;
  currentBigFeedItem: TSFixme;
  selectedProjectTemplate: TSFixme;
  projectTemplateLongDesc: TSFixme;
  isRenamingProject: boolean;
  projectFilter: TSFixme;
  private userProfile: any = null;
  private currentUser: any = null;
  private authSubscription: any = null;
  /** Lowercased membership tier ('free' | 'pro' | 'enterprise'), drives the sidebar membership button. */
  private membershipTier: string = 'free';

  constructor({ from }: { from: string }) {
    super();

    this.lessonTemplatesModel = LessonTemplatesModel.instance;
    this.lessonProjectsModel = new LessonsProjectsModel();
    this.projectsModel = LocalProjectsModel.instance;
    this.tutorialsModel = new TutorialsModel();
    this.from = from;

    this.attachBackgroundUpdateListener();
  }

  private async initializeUserData() {
    // Subscribe before reading the session: onAuthStateChange replays the initial
    // session to new subscribers, so this both closes the window where a session
    // restored mid-await would be missed and covers a getSession() that hangs or
    // throws, either of which used to leave the sidebar user island empty until the
    // next reload.
    if (!this.authSubscription) {
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
        if (newSession?.user) {
          this.applySignedInUser(newSession.user);
        } else {
          this.currentUser = null;
          this.userProfile = null;
          this.membershipTier = 'free';
          this.setSidebarUserVisible(false);
        }
      });
      this.authSubscription = subscription;
    }

    try {
      // Quickly load from session cache to avoid UI delay
      const { data: { session } } = await supabase.auth.getSession();

      if (session?.user) {
        this.applySignedInUser(session.user);
      } else if (!this.currentUser) {
        this.setSidebarUserVisible(false);
      }
    } catch (error: any) {
      console.error('Error initializing user data:', error);
      // Fall back to basic user info if available
      if (this.currentUser) {
        this.applySignedInUser(this.currentUser);
      }
    }
  }

  /**
   * Populate and reveal the sidebar user island for `user`. Safe to call repeatedly —
   * the profile is only refetched when it is for a different user or when a previous
   * fetch left us without one (otherwise a failed fetch was never retried, leaving the
   * plan line and membership button stuck on their defaults).
   */
  private applySignedInUser(user: any) {
    const isNewUser = !this.currentUser || this.currentUser.id !== user.id;
    if (isNewUser) {
      this.userProfile = null;
      this.membershipTier = 'free';
    }
    this.currentUser = user;

    // Fill in name/email/plan first so the island is never revealed blank
    this.updateSidebarUserInfo();
    this.setSidebarUserVisible(true);

    if (isNewUser || !this.userProfile) {
      this.fetchExtendedUserProfile(user.id);
    }
  }

  /**
   * The island's display rule is !important, so jQuery show()/hide() cannot move it —
   * visibility has to go through this class. See projectsview.html.
   */
  private setSidebarUserVisible(visible: boolean) {
    const $userSection = this.$('.sidebar-user');
    if (!$userSection || !$userSection.length) return;
    $userSection.toggleClass('is-signed-in', visible);
  }

  private async fetchExtendedUserProfile(userId: string) {
    try {
      const profile = await getUserProfile(userId);
      // The signed-in user may have changed while the request was in flight
      if (!this.currentUser || this.currentUser.id !== userId) return;
      this.userProfile = profile;
      this.updateSidebarUserInfo();
    } catch (error) {
      console.error('Failed to grab extended user profile:', error);
    }
  }

  private updateSidebarUserInfo() {
    if (!this.currentUser) return;

    const $userSection = this.$('.sidebar-user');
    if (!$userSection || !$userSection.length) return;

    const $avatar = $userSection.find('.avatar');
    const $name = $userSection.find('.user-info .name');
    const $email = $userSection.find('.user-info .email');
    let $plan = $userSection.find('.user-info .plan');

    // The profiles row carries the name as first_name/last_name (with name/surname as
    // aliases); full_name is not a column, so resolve it from whatever is present.
    const profileName = [
      this.userProfile?.full_name,
      [this.userProfile?.first_name, this.userProfile?.last_name].filter(Boolean).join(' '),
      [this.userProfile?.name, this.userProfile?.surname].filter(Boolean).join(' ')
    ]
      .map((n) => (typeof n === 'string' ? n.trim() : ''))
      .find((n) => n.length > 0);

    const emailPrefix = this.currentUser.email ? this.currentUser.email.split('@')[0] : '';
    const displayName = profileName || emailPrefix || 'User';

    // Update avatar with first letter of name or email
    $avatar.text(displayName.charAt(0).toUpperCase());

    // Update name
    $name.text(displayName);

    // Update email
    $email.text(this.currentUser.email || 'No email');

    // Ensure plan element exists
    if (!$plan.length) {
      $plan = $('<div class="plan"/>').appendTo($userSection.find('.user-info'));
    }

    // Set plan text and color. The tier lives in membership_level (with plan as the
    // human-readable label); subscription_status is the legacy column name and is
    // absent on current rows, so it is only a last-resort fallback.
    const tier = [this.userProfile?.membership_level, this.userProfile?.plan, this.userProfile?.subscription_status]
      .map((v) => (typeof v === 'string' ? v.trim() : ''))
      .find((v) => v.length > 0);

    const subscriptionStatus = (tier || 'free').toLowerCase();
    let planDisplay = subscriptionStatus.charAt(0).toUpperCase() + subscriptionStatus.slice(1);
    let planColor = 'rgba(255, 255, 255, 0.5)';
    if (subscriptionStatus === 'pro') {
      planDisplay = 'Pro';
      planColor = '#67DE92';
    } else if (subscriptionStatus === 'premium') {
      // 'premium' is the DB enum's paid individual tier (there is no 'pro' label)
      planDisplay = 'Premium';
      planColor = '#67DE92';
    } else if (subscriptionStatus === 'enterprise') {
      planDisplay = 'Enterprise';
      planColor = '#67DE92';
    }
    $plan.text(planDisplay).css('color', planColor);

    this.membershipTier = subscriptionStatus;

    // The button stays visible on every tier, but there is nothing to upgrade to on a
    // paid plan — pro/enterprise get a plan-management action instead of the upgrade CTA.
    const $upgrade = $userSection.find('.sidebar-upgrade');
    if ($upgrade.length) {
      const action = this.getMembershipAction(subscriptionStatus);
      const $label = $upgrade.find('.sidebar-upgrade-label');
      if ($label.length) {
        $label.text(action.label);
      } else {
        $upgrade.text(action.label);
      }
      $upgrade.attr('title', action.title);
      $upgrade.toggleClass('is-manage-plan', action.isPaidPlan);
    }
  }

  /**
   * Label/tooltip/target for the sidebar membership button. Free accounts are asked to
   * upgrade; paid tiers (pro/premium/enterprise) get their account settings instead,
   * since there is nothing to upgrade to.
   */
  private getMembershipAction(subscriptionStatus: string) {
    if (subscriptionStatus === 'pro' || subscriptionStatus === 'premium' || subscriptionStatus === 'enterprise') {
      return {
        label: 'Account settings',
        title: 'Manage your XGENIA account',
        url: 'https://primora.xgenia.ai/user-panel',
        isPaidPlan: true
      };
    }

    return {
      label: 'Upgrade',
      title: 'See XGENIA plans and pricing',
      url: 'https://xgenia.ai/pricing',
      isPaidPlan: false
    };
  }

  attachBackgroundUpdateListener() {
    this._backgroundUpdateListener = () => {
      if (!this._backgroundUpdateTimeout) {
        this._backgroundUpdateTimeout = setTimeout(async () => {
          await this.projectsModel.fetch();
          this._backgroundUpdateTimeout = undefined;
        }, 3000);
      }
    };

    document.addEventListener('mousemove', this._backgroundUpdateListener);
  }

  dispose() {
    document.removeEventListener('mousemove', this._backgroundUpdateListener);
    clearTimeout(this._backgroundUpdateTimeout);
    this._backgroundUpdateTimeout = undefined;

    this.projectsModel.off(this);

    this.lessonTemplatesModel.off(this);
    this.lessonProjectsModel.off(this);

    if (this.authSubscription) {
      this.authSubscription.unsubscribe();
      this.authSubscription = null;
    }
  }

  render() {
    this.el = this.bindView($(ProjectsViewTemplate), this);

    this.showSpinner();
    this.projectsModel.fetch().then(() => this.hideSpinner());

    // Start with projects visible, Learn hidden
    this._showProjects();

    // Lesson items
    // this.renderLessonItems();
    this.lessonTemplatesModel.on(
      ['templatesChanged'],
      () => {
        this.renderTutorialItems();
      },
      this
    );
    this.lessonProjectsModel.on(
      'lessonProgressChanged',
      () => {
        this.renderTutorialItems();
      },
      this
    );

    // Project items
    this.renderProjectItemsPane();

    this.projectsModel.on('myProjectsChanged', () => this.renderProjectItemsPane(), this);

    this.switchPane('projects');

    // this.$('#top-bar').css({ height: this.topBarHeight + 'px' });
    // this.$('#projects-header').css({ top: this.topBarHeight + 'px' });
    this.$('#search').on('keyup', this.onProjectsSearchChanged.bind(this));

    // Initialize user data immediately after render
    this.initializeUserData();

    return this.el;
  }

  // Update page title based on current view
  updatePageTitle(title: string) {
    this.$('#page-title').text(title);
  }

  // Sidebar/top nav actions
  onSidebarProjectsClicked() {
    const createBtn = this.$('.projects-create-new-project')[0];
    if (createBtn && createBtn.offsetParent !== null) {
      this.onBackToProjectsListClicked();
    }
    this.switchPane('projects');
    this.$('.sidebar-item').removeClass('is-active');
    this.$('.sidebar-item:contains("Projects")').addClass('is-active');
    this._showProjects();
    this.updatePageTitle('Recent projects');
    this.$('#start-pane-feed-big').hide();
  }
  onSidebarLearnClicked() {
    const createBtn = this.$('.projects-create-new-project')[0];
    if (createBtn && createBtn.offsetParent !== null) {
      this.onBackToProjectsListClicked();
    }
    this.switchPane('projects');
    this.selectedTutorialCategory = 'Learn';
    this.renderTutorialItems();
    this._showLearn();
    this.updatePageTitle('Learn');
    this.$('#start-pane-feed-big').hide();
  }
  onSidebarTutorialsClicked() {
    const createBtn = this.$('.projects-create-new-project')[0];
    if (createBtn && createBtn.offsetParent !== null) {
      this.onBackToProjectsListClicked();
    }
    this.switchPane('projects');
    this.selectedTutorialCategory = 'Resources';
    this.renderTutorialItems();
    this._showLearn();
    this.updatePageTitle('Tutorials');
    this.$('#start-pane-feed-big').hide();
  }
  onSidebarVideosClicked() {
    const createBtn = this.$('.projects-create-new-project')[0];
    if (createBtn && createBtn.offsetParent !== null) {
      this.onBackToProjectsListClicked();
    }
    this.switchPane('projects');
    this.selectedTutorialCategory = 'Video Tutorials';
    this.renderTutorialItems();
    this._showLearn();
    this.updatePageTitle('Video Tutorials');
    this.$('#start-pane-feed-big').hide();
  }
  onTopDocsClicked() {
    platform.openExternal('https://docsapp.xgenia.com');
  }
  onTopCommunityClicked() {
    platform.openExternal('https://discord.com/invite/n4P5zkpvFE');
  }
  onSidebarWhatsNewClicked() {
    platform.openExternal('https://xgenia.ai/whats-new');
  }
  onSidebarReleaseNotesClicked() {
    platform.openExternal('https://github.com/XgeniaORG/XGENIA/releases');
  }
  onSidebarHelpClicked() {
    platform.openExternal('https://xgenia.ai/help');
  }
  onSidebarUpgradeClicked() {
    platform.openExternal(this.getMembershipAction(this.membershipTier).url);
  }

  onUserProfileClicked() {
    const $profileArea = this.$('.user-profile-area');
    const $dropdown = this.$('.user-dropdown-menu');

    // Toggle dropdown visibility
    const dropdownElem = $dropdown[0];
    if (dropdownElem && dropdownElem.offsetParent !== null) {
      $dropdown.fadeOut(200);
      $profileArea.removeClass('active');
    } else {
      $dropdown.fadeIn(200);
      $profileArea.addClass('active');

      // Close dropdown when clicking outside
      const closeDropdown = (e) => {
        if (!$(e.target).closest('.sidebar-user').length) {
          $dropdown.fadeOut(200);
          $profileArea.removeClass('active');
          $(document).off('click', closeDropdown);
        }
      };

      // Add slight delay to prevent immediate closing
      setTimeout(() => {
        $(document).on('click', closeDropdown);
      }, 100);
    }
  }

  async onSidebarLogoutClicked(scope: any, el: any, evt: any) {
    if (evt) {
      evt.preventDefault();
      evt.stopPropagation();
    }
    try {
      // Close dropdown first
      this.$('.user-dropdown-menu').fadeOut(200);
      this.$('.user-profile-area').removeClass('active');

      const keysToRemove: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key && (key.includes('supabase') || key.includes('sb-') || key.includes('auth-token'))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(k => window.localStorage.removeItem(k));

      try {
        await supabaseSignOut();
      } catch (err) {
        console.warn('Supabase signout threw an error, ignoring...', err);
      }

      console.log('User logged out successfully from dashboard');
      // Force a page reload to ensure AuthContext completely resets and shows login
      window.location.reload();
    } catch (error) {
      console.error('Logout error:', error);
      ToastLayer.showError('Logout failed. Trying forceful reload.');
      window.location.reload();
    }
  }

  // Main tabs
  onMainTabLearnClicked() {
    this.$('#tab-learn').addClass('selected');
    this.$('#tab-resources').removeClass('selected');
    this.$('#learnTab').show();
    this.$('#resourcesTab').hide();
  }
  onMainTabResourcesClicked() {
    this.$('#tab-learn').removeClass('selected');
    this.$('#tab-resources').addClass('selected');
    this.$('#learnTab').hide();
    this.$('#resourcesTab').show();
  }

  _showProjects() {
    this.$('#learnTabsStrip').hide();
    this.$('#learnTab').hide();
    this.$('#resourcesTab').hide();
    this.$('#projectsTab').show();
    this.updatePageTitle('Recent projects');
  }

  _showLearn() {
    this.$('#learnTabsStrip').show();
    this.$('#projectsTab').hide();
    this.$('#learnTab').show();
    this.$('#resourcesTab').hide();
    const pane = this.$('#projectsPane').get(0);
    if (pane) pane.scrollTo({ top: 220, behavior: 'smooth' });
    // Title will be set by the specific sidebar click handler
  }

  switchPane(pane) {
    const panes = ['start', 'learn', 'projects'];

    /* if (this.isShowingAdminSettings) {
      this.hideAdminSettings();
    }*/
    panes.forEach((p) => {
      if (pane === p) {
        this.$('#' + p + 'PaneTab').addClass('projects-header-tab-selected');
        this.$('#' + p + 'Pane').show();
      } else {
        this.$('#' + p + 'PaneTab').removeClass('projects-header-tab-selected');
        this.$('#' + p + 'Pane').hide();
      }
    });
  }

  // Start or resume a lesson
  onLessonItemClicked(scope) {
    const _this = this;
    const activityId = 'starting-lesson';

    ToastLayer.showActivity('Starting lesson', activityId);

    this.lessonProjectsModel.loadLessonProject(
      scope.template,
      function (project) {
        ToastLayer.hideActivity(activityId);

        if (!project) {
          ToastLayer.showError("Couldn't load project.");
          return;
        }

        _this.notifyListeners('projectLoaded', project);
      },
      function (progress) {
        ToastLayer.showProgress('Starting lesson', (progress.progress / progress.total) * 100, activityId);
      }
    );
  }
  // Restart a lesson
  onRestartLessonItemClicked(scope, el, evt) {
    const _this = this;
    const activityId = 'restart-lesson';

    ToastLayer.showActivity('Restarting lesson', activityId);

    this.lessonProjectsModel.restartLessonProject(
      scope.template,
      function (project) {
        ToastLayer.hideActivity(activityId);

        if (!project || project.result === 'failure') {
          ToastLayer.showError('Could not restart lesson');
          return;
        }

        _this.notifyListeners('projectLoaded', project);
      },
      function (progress) {
        ToastLayer.showProgress('Restarting lesson', (progress.progress / progress.total) * 100, activityId);
      }
    );

    evt.stopPropagation();
    evt.preventDefault();
  }
  renderProjectItemsPane() {
    const localProjects = this.projectsModel.getProjects();

    // Populate both possible containers (projectsTab and legacy area)
    this.$('#local-projects, #local-projects2').css({ display: 'initial' });
    this.$('#projectsTab .local-projects-items, .projects-list > div .local-projects-items').html('');
    this.renderProjectItems({ items: localProjects, appendProjectItemsTo: '#projectsTab .local-projects-items', filter: this.projectFilter });
    this.renderProjectItems({ items: localProjects, appendProjectItemsTo: '.projects-list > div .local-projects-items', filter: this.projectFilter });

    // Update sidebar counts
    this.$('#sidebar-projects-count').text(`(${localProjects.length || 0})`);

    // No New Project tile (import-only flow as requested)

    const emptyDisplay = localProjects.length == 0 ? 'initial' : 'none';
    this.$('#no-projects, #no-projects2').css({ display: emptyDisplay });

    // Setup horizontal scroll controls for project list
    const $projectsList = this.$('#projectsTab .local-projects-items');
    const $left = this.$('#project-items-scroll-controls-left');
    const $right = this.$('#project-items-scroll-controls-right');

    if ($projectsList && $projectsList.length) {
      // Update arrow disabled state
      const updateArrows = () => {
        const el = $projectsList.get(0);
        const canScrollLeft = el.scrollLeft > 0;
        const canScrollRight = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
        $left.attr('class', canScrollLeft ? '' : 'disabled');
        $right.attr('class', canScrollRight ? '' : 'disabled');
      };

      $projectsList.off('scroll.projectArrows').on('scroll.projectArrows', updateArrows);
      setTimeout(updateArrows, 0);
    }

    // Render project template items (basic)
    templateRegistry
      .list({})
      .then((templates) => {
        this.$('.projects-create-from-template').html('');
        if (templates) {
          // Sort templates into categories
          const categories = [];
          templates.forEach((t) => {
            let c = categories.find((c) => c.label === t.category);
            if (c === undefined) {
              c = { label: t.category, templates: [] };
              categories.push(c);
            }
            c.templates.push(t);
          });

          categories.forEach((c) => {
            const cel = this.bindView(this.cloneTemplate('projects-template-category'), c);
            this.$('.projects-create-from-template').append(cel);

            c.templates.forEach((i) => {
              if (i.type !== undefined) return; // Only basic types

              const el = this.bindView(this.cloneTemplate('projects-template-item'), i);

              i.iconURL &&
                this._downloadImageAsURI(i.iconURL, function (uri) {
                  el.find('.feed-item-image').css('background-image', 'url(' + uri + ')');
                });

              View.$(cel, '.templates').append(el);
            });
          });
        }
      })
      .catch((error) => {
        console.warn('Failed to fetch templates:', error);
        // Show a user-friendly message in the UI
        this.$('.projects-create-from-template').html(
          '<div class="template-error">Unable to load project templates. Please check your internet connection.</div>'
        );
      });

    // Always start at lessons
    this.selectedTutorialCategory = 'Learn';

    // Render tutorials
    this.tutorialsModel.list((items) => {
      this.renderTutorialItems();
    });

    // Create new project popup
    this.$('#create-new-project-from-feed-item-name').on('keyup', () => {
      const val = this.$('#create-new-project-from-feed-item-name').val();
      this.$('#create-new-project-button').prop('disabled', val === undefined || val === '');
    });

    // Import project popup
    this.$('#import-existing-project-name').on('keyup', () => {
      const val = this.$('#import-existing-project-name').val();
      this.$('#import-new-project-button').prop('disabled', val === undefined || val === '');
    });
  }
  _getTutorialCategories() {
    const lessonCategories = this.lessonTemplatesModel.getCategories();
    const tutorialCategories = this.tutorialsModel.getCategories();

    const allCategories = Array.from(new Set(lessonCategories.concat(tutorialCategories)));
    const isShowingVideos = this.selectedTutorialCategory === 'Video Tutorials';

    // Filter out video-related categories or vice versa
    const filteredCategories = allCategories.filter(category => {
      const categoryStr = String(category);
      const isVideo = categoryStr.toLowerCase().includes('video');
      return isShowingVideos ? isVideo : !isVideo;
    });

    // Map categories to better display names
    return filteredCategories.map(category => this._mapCategoryName(String(category)));
  }

  _getCategoryMappings() {
    return {
      'Lessons': 'Learn',
      'Guides': 'Resources',
      'Documentation': 'Reference',
      'Tutorial': 'Learn',
      'Tutorials': 'Learn',
      'Videos': 'Video Tutorials',
      'Video': 'Video Tutorials',
      'Video tutorials': 'Video Tutorials'
    };
  }

  _mapCategoryName(originalName: string): string {
    const mappings = this._getCategoryMappings();
    return mappings[originalName] || originalName;
  }

  renderProjectItems(options: {
    items?: ProjectItem[];
    appendProjectItemsTo?: string;
    filter?: string;
    template?: string;
  }) {
    options = options || {};

    const items = options.items;
    const projectItemsSelector = options.appendProjectItemsTo || '.projects-items';
    const template = options.template || 'projects-item';
    this.$(projectItemsSelector).html('');

    for (const i in items) {
      const label = items[i].name;
      if (options.filter && label.toLowerCase().indexOf(options.filter) === -1) continue;

      const latestAccessed = items[i].latestAccessed || Date.now();

      const scope: ProjectItemScope = {
        project: items[i],
        label: label,
        latestAccessedTimeAgo: timeSince(latestAccessed) + ' ago'
      };

      const el = this.bindView(this.cloneTemplate(template), scope);
      if (items[i].thumbURI) {
        console.log('Thumbnail URI:', items[i].thumbURI);
        View.$(el, '.projects-item-thumb').css('background-image', 'url(' + items[i].thumbURI + ')');
      } else {
        console.log('No thumbnail for project:', items[i].name);
        View.$(el, '.projects-item-cloud-download').show();
      }

      const thumbElement = View.$(el, '.projects-item-thumb');
      console.log('Thumb element found:', thumbElement.length > 0);

      this.$(projectItemsSelector).append(el);
    }
  }

  renderTutorialItems() {
    // Render categories
    const categories = this._getTutorialCategories();

    this.$('.tutorial-categories').html('');

    if (categories.length > 1) {
      for (const category of categories) {
        const el = this.bindView(this.cloneTemplate('tutorial-category-item'), {
          name: category,
          selected: this.selectedTutorialCategory === category
        });

        this.$('.tutorial-categories').append(el);
      }
    }

    // Find the original category name that maps to the selected display name
    const originalSelectedCategory = Object.keys(this._getCategoryMappings())
      .find(key => this._getCategoryMappings()[key] === this.selectedTutorialCategory) || this.selectedTutorialCategory;

    const lessons = this.lessonTemplatesModel
      .getTemplates()
      .filter((lesson) => {
        const mappedCategory = this._mapCategoryName(lesson.category || 'Learn');
        return mappedCategory === this.selectedTutorialCategory;
      })
      .filter((lesson) => {
        // Filter out the "XGENIA AI Walkthrough" lesson
        return !(lesson.title && lesson.title.toLowerCase().includes('xgenia ai walkthrough')) &&
          !(lesson.label && lesson.label.toLowerCase().includes('xgenia ai walkthrough')) &&
          !(lesson.title && lesson.title.toLowerCase().includes('ai walkthrough')) &&
          !(lesson.type === 'highlight' && lesson.title && lesson.title.toLowerCase().includes('ai'));
      });

    const categoryHasLessons = lessons.length > 0;

    this.$('.tutorial-items').html('');
    if (categoryHasLessons) {
      this.$('#lesson-items-scroll-controls-left').attr('class', 'disabled');
      this.$('#lesson-items-scroll-controls-right').attr('class', '');
      this.$('.tutorial-items')
        .off('scroll')
        .on('scroll', (e) => {
          this.$('#lesson-items-scroll-controls-left').attr('class', e.target.scrollLeft > 0 ? '' : 'disabled');
          const canScrollRight = e.target.scrollLeft + e.target.clientWidth < e.target.scrollWidth;
          this.$('#lesson-items-scroll-controls-right').attr('class', canScrollRight ? '' : 'disabled');
        });
    }

    this.$('.lesson-items-scroll-controls').css('display', categoryHasLessons ? 'flex' : 'none');

    if (categoryHasLessons) {
      this.$('.tutorial-items').addClass('with-lessons');
    } else {
      this.$('.tutorial-items').removeClass('with-lessons');
    }

    //start by adding lessons, then tutorial cards
    //1. lessons
    const lessonProgress = lessons.map(
      (l) => this.lessonProjectsModel.getLessonProjectProgress(l.name) || { index: 0, end: 0 }
    );

    const lessonStates = getLessonsState(lessonProgress);

    lessons.forEach((lesson, index) => {
      const state = lessonStates[index];

      let buttonText = 'Start lesson';
      if (state.name === 'in-progress') {
        buttonText = 'Continue lesson';
      } else if (state.name === 'completed') {
        buttonText = 'Open lesson';
      }

      const el = this.bindView(this.cloneTemplate('tutorial-lesson-item'), {
        template: lesson,
        showRestart: state.progressPercent > 0,
        buttonText,
        completionText: state.progressPercent + '%',
        completed: state.name === 'completed',
        isFeatureHighlight: lesson?.type === 'highlight'
      });

      el.addClass(state.name);
      if (state.isNextUp) {
        el.addClass('next-up');
      }

      const imageUrl = this.tutorialsModel.absoluteUrl(lesson.thumb);
      el.find('.projects-tutorial-item-thumb').attr('srcset', imageUrl + ' 2x');

      const badgeUrl = this.tutorialsModel.absoluteUrl(lesson.completionBadge);
      el.find('.projects-lesson-item-badge').attr('srcset', badgeUrl + ' 2x');

      el.find('.progress').css({ width: state.progressPercent + '%' });
      this.$('.tutorial-items').append(el);
    });

    const tutorials = this.tutorialsModel.tutorials.filter((t) => {
      const mappedCategory = this._mapCategoryName(t.category || 'Resources');
      return mappedCategory === this.selectedTutorialCategory;
    });

    //2. tutorial cards
    for (const item of tutorials) {
      const el = this.bindView(this.cloneTemplate('tutorial-item'), item);
      const imageUrl = this.tutorialsModel.absoluteUrl(item.thumb);
      el.find('.projects-tutorial-item-thumb').attr('srcset', imageUrl + ' 2x');
      this.$('.tutorial-items').append(el);
    }
  }
  _getLessonScrollState() {
    const parentRect = this.$('.tutorial-items').get(0).getBoundingClientRect();

    const lessonDivs: HTMLDivElement[] = Array.from(this.$('.tutorial-items').get(0).children);
    const rects = lessonDivs.map((child) => child.getBoundingClientRect());

    const scrollIndex = Math.max(
      0,
      rects.findIndex(({ left }) => left >= parentRect.left)
    );

    const itemSize = rects[0].width + 10;
    const itemsPerPage = Math.floor(parentRect.width / itemSize);

    return {
      scrollIndex,
      itemsPerPage,
      lessonDivs
    };
  }
  onLessonsScrollLeftClicked() {
    const { scrollIndex, itemsPerPage, lessonDivs } = this._getLessonScrollState();
    const targetIndex = Math.max(0, scrollIndex - itemsPerPage);

    lessonDivs[targetIndex].scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'start'
    });
  }
  onLessonsScrollRightClicked() {
    const { scrollIndex, itemsPerPage, lessonDivs } = this._getLessonScrollState();
    const targetIndex = Math.min(lessonDivs.length - 1, Math.max(0, scrollIndex + itemsPerPage));

    lessonDivs[targetIndex].scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'start'
    });
  }

  onProjectsScrollLeftClicked() {
    const container = this.$('#projectsTab .local-projects-items').get(0);
    if (!container) return;
    const cardWidth = this._getProjectCardWidth(container) + 24; // include gap
    const scrollBy = cardWidth;
    container.scrollBy({ left: -scrollBy, behavior: 'smooth' });
  }

  onProjectsScrollRightClicked() {
    const container = this.$('#projectsTab .local-projects-items').get(0);
    if (!container) return;
    const cardWidth = this._getProjectCardWidth(container) + 24; // include gap
    const scrollBy = cardWidth;
    container.scrollBy({ left: scrollBy, behavior: 'smooth' });
  }

  private _getProjectCardWidth(container: HTMLElement): number {
    const first = container.querySelector('.projects-item') as HTMLElement;
    if (first) return first.getBoundingClientRect().width;
    return Math.floor(container.clientWidth * 0.6) || 520;
  }

  onTutorialCategoryClicked(scope) {
    this.selectedTutorialCategory = scope.name;
    this.renderTutorialItems();
  }
  onTutorialItemClicked(scope) {
    tracker.track('Tutorial Card Clicked', {
      label: scope.label,
      url: scope.url
    });
    platform.openExternal(this.tutorialsModel.absoluteUrl(scope.url));
  }
  _downloadImageAsURI(url, callback) {
    if (_cache[url]) {
      if (_cache[url].isCompleted) return callback(_cache[url].uri);
      else return _cache[url].waiting.push(callback);
    }

    _cache[url] = {
      waiting: [callback]
    };

    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.setRequestHeader('Accept', 'image/*');
    xhr.responseType = 'blob';
    xhr.onload = function (e) {
      _cache[url].isCompleted = true;

      if (this.status === 200) {
        _cache[url].uri = URL.createObjectURL(this.response);
        _cache[url].waiting.forEach((c) => c(_cache[url].uri));
      } else _cache[url].waiting.forEach((c) => c());
    };
    xhr.onerror = function () {
      callback();
    };
    xhr.responseType = 'blob';
    xhr.send();
  }
  _downloadVideoAsURI(url, callback) {
    if (_cache[url]) {
      if (_cache[url].isCompleted) return callback(_cache[url].uri);
      else return _cache[url].waiting.push(callback);
    }

    _cache[url] = {
      waiting: [callback]
    };

    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.setRequestHeader('Accept', 'video/*');
    xhr.responseType = 'blob';
    xhr.onload = function (e) {
      _cache[url].isCompleted = true;

      if (this.status === 200) {
        _cache[url].uri = URL.createObjectURL(this.response);
        _cache[url].waiting.forEach((c) => c(_cache[url].uri));
      } else _cache[url].waiting.forEach((c) => c());
    };
    xhr.onerror = function () {
      callback();
    };
    xhr.responseType = 'blob';
    xhr.send();
  }

  onExitBigFeedItemClicked(scope) {
    this.$('#start-pane-feed-big').hide();
    // Clear the image to prevent stale content
    this.$('#start-pane-feed-item-big-image').css('background-image', '').html('');
  }

  onCreateNewProjectClicked() {
    this.$('.projects-create-new-project').show();
    //enable scrolling on the entire parent pane so the templates can be scrolled
    //TODO: clean this up so no JS is required to scroll
    this.$('#projectsPane').css({ overflowY: 'auto' });

    this.$('.projects-list').hide();
  }


  onBackToProjectsListClicked() {
    this.$('.projects-create-new-project').hide();
    this.$('.projects-import-existing-project').hide();
    this.$('.projects-list').show();
    this.$('#projectsPane').css({ overflowY: '' });
    // Clear any popup images
    this.$('#start-pane-feed-item-big-image').css('background-image', '').html('');
  }

  async onImportExistingProjectClicked() {
    const direntry = await filesystem.openDialog({
      allowCreateDirectory: false
    });

    if (!direntry) return;

    const activityId = 'opening-project';

    ToastLayer.showActivity('Opening project', activityId);

    try {
      const project = await this.projectsModel.openProjectFromFolder(direntry);

      if (!project.name) {
        project.name = filesystem.basename(direntry);
      }

      this.notifyListeners('projectLoaded', project);
    } catch (e: any) {
      ToastLayer.showError('Could not open project');
    } finally {
      ToastLayer.hideActivity(activityId);
    }
  }

  onRenameProjectClicked(scope: ProjectItemScope, el, evt) {
    const input = el.parents('.projects-item').find('#project-name-input');
    const container = el.parents('.projects-item').find('#project-name');

    input.val(scope.label);
    container.show();

    this.isRenamingProject = true;

    input.off('blur').on('blur', () => {
      container.hide();

      //hack to make sure this isn't set to false before the click event
      //on the project item has had a chance to see this flag (blur comes before click)
      setTimeout(() => {
        this.isRenamingProject = false;
      }, 100);

      const newName = input.val();
      if (newName !== scope.label) {
        this.projectsModel.renameProject(scope.project.id, input.val());
      }
    });

    input.off('keyup').on('keyup', (e) => {
      if (e.keyCode === 13) {
        input.blur();
      }
    });

    input.off('click').on('click', (e) => {
      e.stopPropagation();
    });

    input.focus();

    evt.stopPropagation();
  }

  onProjectsSearchChanged() {
    const filter = this.$('#search').val();
    this.projectFilter = filter === '' ? undefined : filter.toLowerCase();
    this.renderProjectItemsPane();
  }

  // Launch a project from the recent list
  async onProjectItemClicked(scope: ProjectItemScope, el) {
    if (this.isRenamingProject) {
      const input = el.find('#project-name-input');
      input.blur();
      return;
    }

    const activityId = 'opening-project';

    ToastLayer.showActivity('Opening project', activityId);

    const project = await this.projectsModel.loadProject(scope.project);
    ToastLayer.hideActivity(activityId);

    if (!project) {
      ToastLayer.showError("Couldn't load project.");
      return;
    }
    console.log('Loaded project', project);

    this.notifyListeners('projectLoaded', project);
  }

  onDeleteProjectClicked(scope: ProjectItemScope, el, evt) {
    evt.stopPropagation();

    DialogLayerModel.instance.showConfirm({
      title: 'Remove project ' + scope.project.name + '?',
      text: 'Do you want to remove the project from the list? Note that the project folder is still left intact, and can be opened again',
      onConfirm: () => this.projectsModel.removeProject(scope.project.id)
    });
  }

  // Import a project from a URL
  importFromUrl(uri) {
    // Extract and remove query from url
    const query = {} as any;
    if (uri.indexOf('?') !== -1) {
      // Has query string
      const queryStr = uri.split('?')[1];
      queryStr.split('&').forEach((pair) => {
        pair = pair.split('=');
        query[pair[0]] = pair[1];
      });

      uri = uri.substring(0, uri.indexOf('?'));
    }

    const iconURL = query.thumb;
    const defaultProjectName = query.name !== undefined ? decodeURIComponent(query.name) : '';

    this.currentBigFeedItem = {
      projectURL: uri,
      useCloudServices: query.cf !== undefined,
      cloudServicesTemplateURL: query.cf !== undefined ? decodeURIComponent(query.cf) : undefined,
      title: defaultProjectName
    };
    this.projectTemplateLongDesc = '';

    this._setCreateProjectPopupMode({ blank: false });

    if (iconURL !== undefined) {
      this._downloadImageAsURI(decodeURIComponent(iconURL), (uri) => {
        if (uri) {
          this.$('#start-pane-feed-item-big-image').css('background-image', 'url(' + uri + ')');
        } else {
          // Show a placeholder when image fails to load
          this.$('#start-pane-feed-item-big-image').html('<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-secondary);"><span class="material-icons-outlined" style="font-size: 48px;">image</span></div>');
        }
      });
    } else {
      // Show a placeholder when no image URL is provided
      this.$('#start-pane-feed-item-big-image').html('<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-secondary);"><span class="material-icons-outlined" style="font-size: 48px;">image</span></div>');
    }

    this.$('#create-new-project-button').prop(
      'disabled',
      defaultProjectName === undefined || defaultProjectName === ''
    );
    this.$('#create-new-project-from-feed-item-name').val(defaultProjectName || '');
    this.$('#start-pane-feed-item-big-content').hide();
    this.$('#start-pane-feed-item-big-create-new-project').show();

    this.$('#start-pane-feed-big').show();
  }

  /**
   * The name popup (#start-pane-feed-big) is shared between the template flow and the
   * blank-project flow. Template mode shows the preview image and the "from template"
   * title; blank mode hides the preview, compacts the popup and only asks for a name.
   */
  _setCreateProjectPopupMode({ blank }: { blank: boolean }) {
    this.$('#start-pane-feed-item-big-image').css('display', blank ? 'none' : 'flex');
    this.$('#start-pane-feed-item-big-title').text(blank ? 'Create new project' : 'Create new project from template');
    this.$('.create-from-template-popup').toggleClass('blank-project-mode', blank);
  }

  onCreateBlankProjectClicked() {
    this.currentBigFeedItem = { title: 'Blank project', blankProject: true };
    this.projectTemplateLongDesc = '';

    this._setCreateProjectPopupMode({ blank: true });

    this.$('#create-new-project-from-feed-item-name').val('');
    this.$('#create-new-project-button').prop('disabled', true);
    this.$('#start-pane-feed-item-big-create-new-project').show();
    this.$('#start-pane-feed-big').show();

    this.$('#create-new-project-from-feed-item-name').focus();
  }

  onSelectTemplateClicked(scope) {
    const _this = this;
    //this.selectedProjectTemplate = scope;
    this.currentBigFeedItem = scope;
    this.projectTemplateLongDesc = scope.desc;

    this._setCreateProjectPopupMode({ blank: false });

    if (scope.iconURL) {
      this._downloadImageAsURI(scope.iconURL, function (uri) {
        if (uri) {
          _this.$('#start-pane-feed-item-big-image').css('background-image', 'url(' + uri + ')');
        } else {
          // Show a placeholder when image fails to load
          _this.$('#start-pane-feed-item-big-image').html('<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-secondary);"><span class="material-icons-outlined" style="font-size: 48px;">image</span></div>');
        }
      });
    } else {
      // Show a placeholder when no image URL is provided
      this.$('#start-pane-feed-item-big-image').html('<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-secondary);"><span class="material-icons-outlined" style="font-size: 48px;">image</span></div>');
    }

    // this._setupCloudServicesSelection(scope);
    this.$('#create-new-project-from-feed-item-name').val(scope.defaultProjectName || '');
    this.$('#start-pane-feed-item-big-content').hide();
    this.$('#start-pane-feed-item-big-create-new-project').show();

    this.$('#create-new-project-button').prop(
      'disabled',
      scope.defaultProjectName === undefined || scope.defaultProjectName === ''
    );
    this.$('#start-pane-feed-big').show();

    this.$('#create-new-project-from-feed-item-name').focus();
  }

  async onNewProjectFromSampleClicked() {
    const projectTemplate = this.currentBigFeedItem;
    if (!projectTemplate) return;
    // Blank projects have no template URL; LocalProjectsModel.newProject scaffolds them
    if (!projectTemplate.projectURL && !projectTemplate.blankProject) return;

    // Show loading state on button
    this.showButtonLoading();

    let direntry;

    try {
      direntry = await filesystem.openDialog({
        allowCreateDirectory: true
      });
    } catch (e: any) {
      this.hideButtonLoading();
      this.updateButtonText('Select project folder location');
      return;
    }

    if (!direntry) {
      this.hideButtonLoading();
      return;
    }

    // Update button text to show we're setting up the template
    this.updateButtonText('Setting up the template...');

    const activityId = 'creating-project';
    ToastLayer.showActivity('Creating new project', activityId);

    const name = this.$('#create-new-project-from-feed-item-name').val() || 'Untitled';

    const path = filesystem.makeUniquePath(filesystem.join(direntry, name));

    const options = {
      name,
      path,
      projectTemplate: projectTemplate.projectURL
    };

    async function _prepareCloudServices(): Promise<CloudServiceMetadata> {
      const cloudServices = {
        name: projectTemplate.title + ' cloud services',
        desc: 'Cloud services created for the ' + projectTemplate.title + ' project template'
      };

      const cf = new CloudFormation();

      return new Promise((resolve, reject) => {
        cf.setup({
          templateUrl: projectTemplate.cloudServicesTemplateURL,
          cloudServices: cloudServices,
          success: resolve,
          error: reject
        });
      });
    }

    this.projectsModel.newProject(async (project) => {
      if (!project) {
        ToastLayer.hideActivity(activityId);
        ToastLayer.showError('Could not create new project.');
        this.hideButtonLoading();
        this.updateButtonText('Select project folder location');
        this.$('#start-pane-feed-item-big-create-new-project').hide();
        this.$('#start-pane-feed-big').hide();
        return;
      }

      // Project is create, now setup cloud services
      if (projectTemplate.useCloudServices) {
        try {
          // Refresh the cloud services acccess token so it's ready for the cloud formation
          const cloudServices = await _prepareCloudServices();
          ToastLayer.hideActivity(activityId);
          if (projectTemplate.useCloudServices && cloudServices === undefined) {
            ToastLayer.showError('Failed to setup cloud services.');
            this.hideButtonLoading();
            this.updateButtonText('Select project folder location');
            return;
          }

          setCloudServices(project, cloudServices);
          this.notifyListeners('projectLoaded', project);
        } catch (e: any) {
          ToastLayer.hideActivity(activityId);
          ToastLayer.showError('Failed to create cloud services for project.');
          this.hideButtonLoading();
          this.updateButtonText('Select project folder location');
        }
      }

      ToastLayer.hideActivity(activityId);
      this.hideButtonLoading();
      this.updateButtonText('Select project folder location');

      tracker.track('Create New Project', {
        templateLabel: projectTemplate.title,
        templateUrl: projectTemplate.projectURL
      });

      this.notifyListeners('projectLoaded', project);
    }, options);
  }

  showSpinner() {
    if (!this.el) return;

    this.$('.page-spinner').show();
  }

  hideSpinner() {
    if (!this.el) return;

    this.$('.page-spinner').hide();
  }

  showButtonLoading() {
    const $button = this.$('#create-new-project-button');
    if ($button && $button.length) {
      $button.addClass('loading');
      $button.prop('disabled', true);
    }
  }

  updateButtonText(text: string) {
    const $button = this.$('#create-new-project-button .button-text');
    if ($button && $button.length) {
      $button.text(text);
    }
  }

  hideButtonLoading() {
    const $button = this.$('#create-new-project-button');
    if ($button && $button.length) {
      $button.removeClass('loading');
      $button.prop('disabled', false);
    }
  }
}
