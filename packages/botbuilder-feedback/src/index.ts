// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Activity, ActivityTypes, CardAction, ConversationState, MessageFactory, Middleware, StoreItem, TurnContext } from 'botbuilder-core';

const DEFAULT_FEEDBACK_ACTIONS = ['👍 good answer', '👎 bad answer'];
const DEFAULT_FEEDBACK_RESPONSE = 'Thanks for your feedback!';
const DEFAULT_DISMISS_ACTION = 'dismiss';
const DEFAULT_FREE_FORM_PROMPT = 'Please add any additional comments in the chat';
const DEFAULT_PROMPT_FREE_FORM = false;
const TRACE_TYPE = 'https://www.example.org/schemas/feedback/trace';
const TRACE_NAME = 'Feedback';
const TRACE_LABEL = 'User Feedback';

export type Message = string | { text: string, speak?: string };

const feedbackAction = (action: FeedbackAction) => typeof action === 'string' ? action : feedbackValue(action);
const feedbackValue = (activity: { text?: string, value?: any }) => activity.value || activity.text;

/** StoreItem to track feedback state */
export interface FeedbackState extends StoreItem {
  feedback: FeedbackRecord;
}

export interface FeedbackContext {
  feedback: FeedbackOptions & { conversationState: ConversationState };
}

/** Options for Feedback Middleware */
export interface FeedbackOptions {

  /** Custom feedback choices for the user. Default values are: `['👍 good answer', '👎 bad answer']` */
  feedbackActions?: FeedbackAction[];

  /** Message to show when a user provides some feedback. Default value is `'Thanks for your feedback!'` */
  feedbackResponse?: Message;

  /** Text to show on button that allows user to hide/ignore the feedback request. Default value is `'dismiss'` */
  dismissAction?: FeedbackAction;

  /** Optionally enable prompting for free-form comments for all or select feedback choices (free-form prompt is shown after user selects a preset choice) */
  promptFreeForm?: boolean | string[];

  /** Message to show when `promptFreeForm` is enabled. Default value is `'Please add any additional comments in the chat'` */
  freeFormPrompt?: Message;
}

/** Record of feedback received */
export interface FeedbackRecord {

  /** arbitrary feedback tagging, for analytics purposes */
  tag: string;

  /** activity sent by the user that triggered the feedback request */
  request: Partial<Activity>;

  /** bot text or value for which feedback is being requested */
  response: string | any;

  /** user's feedback selection */
  feedback: string | any;

  /** user's free-form comments, if enabled */
  comments: string;
}

export type FeedbackAction = string | CardAction;
export type ContextWithFeedback = TurnContext & FeedbackContext;

/** Middleware that managegs user feedback prompts, and stores responses in the transcript log */
export class Feedback implements Middleware {

  /**
   * Returns a message that includes feedback prompts in the form of Suggested Actions
   * @param context current bot context
   * @param textOrActivity message sent to the user for which feedback is being requested.
   * If the message is an Activity, and already contains a set of suggested actions, the feedback actions will be appened to the existing actions.
   * @param tag optional tag so that feedback responses can be grouped for analytics purposes
   */
  static createFeedbackMessage(context: TurnContext, textOrActivity: string|Partial<Activity>, tag?: string): Partial<Activity> {
    const feedbackContext = context as ContextWithFeedback;
    const state = feedbackContext.feedback.conversationState.get(context) as StoreItem & FeedbackState; // TODO SDK Feedback: get() should be generic
    const actions = feedbackContext.feedback.feedbackActions.concat(feedbackContext.feedback.dismissAction)
      .filter((x) => !!x);

    state.feedback = { // this should be put on the context object. onTurn should move it from context to state after await next()
      tag,
      request: context.activity,
      response: typeof textOrActivity === 'string' ? textOrActivity : feedbackValue(textOrActivity),
      feedback: null,
      comments: null,
    };

    if (typeof textOrActivity === 'string') {
      const text = textOrActivity;
      return MessageFactory.suggestedActions(actions, text);
    } else {
      const activity = textOrActivity;
      const suggestedActions = MessageFactory.suggestedActions(actions).suggestedActions;
      if (activity.suggestedActions) {
        activity.suggestedActions.actions = activity.suggestedActions.actions.concat(suggestedActions.actions);
      } else {
        activity.suggestedActions = suggestedActions;
      }
      return activity;
    }
  }

  /**
   * Sends a message that includes feedback prompts in the form of Suggested Actions
   * @param context current bot context
   * @param textOrActivity message sent to the user for which feedback is being requested.
   * If the message is an Activity, and already contains a set of suggested actions, the feedback actions will be appened to the existing actions.
   * @param tag optional tag so that feedback responses can be grouped for analytics purposes
   */
  static sendFeedbackActivity(context: TurnContext, textOrActivity: string | Partial<Activity>, tag?: string) {
    const message = Feedback.createFeedbackMessage(context, textOrActivity, tag);
    return context.sendActivity(message);
  }

  /**
   * Create a new Feedback middleware instance
   * @param conversationState The instance of `ConversationState` used by your bot
   * @param options Optional configuration parameters for the feedback middleware
   */
  constructor(private conversationState: ConversationState, private options?: FeedbackOptions) {
    this.options = options || {};
    if (!this.options.feedbackActions) {
      this.options.feedbackActions = DEFAULT_FEEDBACK_ACTIONS;
    }
    if (!this.options.feedbackResponse) {
      this.options.feedbackResponse = DEFAULT_FEEDBACK_RESPONSE;
    }
    if (!this.options.dismissAction) {
      this.options.dismissAction = DEFAULT_DISMISS_ACTION;
    }
    if (!this.options.freeFormPrompt) {
      this.options.freeFormPrompt = DEFAULT_FREE_FORM_PROMPT;
    }
    if (!this.options.promptFreeForm) {
      this.options.promptFreeForm = DEFAULT_PROMPT_FREE_FORM;
    }
  }

  async onTurn(context: ContextWithFeedback, next: () => Promise<void>): Promise<void> {

    // store feedback options on the context object so that they can be used downstream by user-invoked `requestFeedback()`
    context.feedback = Object.assign({}, this.options, { conversationState: this.conversationState });

    const record = await this.getFeedbackState(context);

    // feedback is pending
    if (record) {
      const canGiveComments = this.userCanGiveComments(context);

      // user is giving free-form comments
      if (record.feedback && this.options.promptFreeForm) {
        record.comments = context.activity.text;
        await this.storeFeedback(context);
        return;

      // user is giving feedback selection
      } else if (this.userGaveFeedback(context)) {
        record.feedback = feedbackValue(context.activity);

        if (canGiveComments) {
          await this.sendMessage(context, this.options.freeFormPrompt);
        } else {
          await this.storeFeedback(context);
        }

        return;

      // user did not provide feedback: clear record and continue
      } else {
        this.clearFeedbackState(context);
        if (!this.userDismissed(context)) {
          return next();
        }
      }

    // no pending feedback, or user did not provide feedback
    } else {
      return next();
    }
  }

  private async getFeedbackState(context: ContextWithFeedback): Promise<FeedbackRecord> {
    const state = await this.conversationState.load(context);
    if (!state) {
      throw new Error('Feedback middleware cannot find a BotState instance. Make sure that your ConversationState middleware is added to your bot before Feedback');
    }

    return state.feedback;
  }

  private clearFeedbackState(context: ContextWithFeedback): void {
    const state = this.conversationState.get(context);
    delete state.feedback;
  }

  private sendMessage(context: TurnContext, message: Message) {
    if (typeof message === 'string') {
      return context.sendActivity(message);
    } else {
      return context.sendActivity(message.text, message.speak);
    }
  }

  private async storeFeedback(context: ContextWithFeedback) {
    const record = await this.getFeedbackState(context);
    this.clearFeedbackState(context);
    await context.sendActivity({
      type: ActivityTypes.Trace,
      valueType: TRACE_TYPE,
      name: TRACE_NAME,
      label: TRACE_LABEL,
      value: record,
    });

    // send optional acknowledgement back to user
    if (this.options.feedbackResponse) {
      await this.sendMessage(context, this.options.feedbackResponse);
    }
  }

  private userCanGiveComments(context: ContextWithFeedback) {
    return this.options.promptFreeForm === true || (Array.isArray(this.options.promptFreeForm) && this.options.promptFreeForm
      .some((x) => x === feedbackValue(context.activity)));
  }

  private userGaveFeedback(context: ContextWithFeedback) {
    return !this.userDismissed(context) && this.options.feedbackActions
      .some((x) => feedbackAction(x) === feedbackValue(context.activity));
  }

  private userDismissed(context: ContextWithFeedback) {
    return feedbackValue(context.activity) === feedbackAction(this.options.dismissAction);
  }
}
