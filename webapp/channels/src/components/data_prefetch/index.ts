// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {connect} from 'react-redux';
import {bindActionCreators} from 'redux';
import type {ActionCreatorsMapObject, Dispatch} from 'redux';

import type {Channel, ChannelMembership} from '@mattermost/types/channels';
import type {PostList} from '@mattermost/types/posts';
import type {RelationOneToOne} from '@mattermost/types/utilities';

import {Preferences} from 'mattermost-redux/constants';
import {getCurrentChannelId, getUnreadChannels} from 'mattermost-redux/selectors/entities/channels';
import {getMyChannelMemberships} from 'mattermost-redux/selectors/entities/common';
import {isPerformanceDebuggingEnabled} from 'mattermost-redux/selectors/entities/general';
import {getBool, isCollapsedThreadsEnabled} from 'mattermost-redux/selectors/entities/preferences';
import {isChannelMuted} from 'mattermost-redux/utils/channel_utils';
import {memoizeResult} from 'mattermost-redux/utils/helpers';

import {prefetchChannelPosts} from 'actions/views/channel';
import {getCategoriesForCurrentTeam} from 'selectors/views/channel_sidebar';

import type {GlobalState} from 'types/store';

import {trackPreloadedChannels} from './actions';
import DataPrefetch from './data_prefetch';

type Actions = {
    prefetchChannelPosts: (channelId: string, delay?: number) => Promise<{data: PostList}>;
    trackPreloadedChannels: (prefetchQueueObj: Record<string, string[]>) => void;
};

enum Priority {
    high = 1,
    medium,
    low
}

// function to return a queue obj with priotiy as key and array of channelIds as values.
// high priority has channels with mentions
// medium priority has channels with unreads
const prefetchQueue = memoizeResult((
    unreadChannels: Channel[],
    memberships: RelationOneToOne<Channel, ChannelMembership>,
    collapsedThreads: boolean,
) => {
    return unreadChannels.reduce((acc: Record<string, string[]>, channel: Channel) => {
        const channelId = channel.id;
        const membership = memberships[channelId];

        // TODO We check for muted channels 3 times here: getUnreadChannels checks it, this checks it, and the mark_unread
        // check below is equivalent to checking if its muted.
        if (membership && !isChannelMuted(membership)) {
            if (collapsedThreads ? membership.mention_count_root : membership.mention_count) {
                return {
                    ...acc,
                    [Priority.high]: [...acc[Priority.high], channelId],
                };
            } else if (
                membership.notify_props &&
                membership.notify_props.mark_unread !== 'mention'
            ) {
                return {
                    ...acc,
                    [Priority.medium]: [...acc[Priority.medium], channelId],
                };
            }
        }
        return acc;
    }, {
        [Priority.high]: [], // 1 being high priority requests
        [Priority.medium]: [],
        [Priority.low]: [], //TODO: add chanenls such as fav.
    });
});

function isSidebarLoaded(state: GlobalState) {
    return getCategoriesForCurrentTeam(state).length > 0;
}

function mapStateToProps(state: GlobalState) {
    const lastUnreadChannel = state.views.channel.lastUnreadChannel;
    const memberships = getMyChannelMemberships(state);
    const unreadChannels = getUnreadChannels(state, lastUnreadChannel);
    const prefetchQueueObj = prefetchQueue(unreadChannels, memberships, isCollapsedThreadsEnabled(state));
    const prefetchRequestStatus = state.views.channel.channelPrefetchStatus;
    const disableWebappPrefetchAllowed = isPerformanceDebuggingEnabled(state);

    return {
        currentChannelId: getCurrentChannelId(state),
        prefetchQueueObj,
        prefetchRequestStatus,
        sidebarLoaded: isSidebarLoaded(state),
        unreadChannels,
        disableWebappPrefetchAllowed,
        dataPrefetchEnabled: getBool(state, Preferences.CATEGORY_ADVANCED_SETTINGS, Preferences.ADVANCED_DATA_PREFETCH, true),
    };
}

function mapDispatchToProps(dispatch: Dispatch) {
    return {
        actions: bindActionCreators<ActionCreatorsMapObject, Actions>({
            prefetchChannelPosts,
            trackPreloadedChannels,
        }, dispatch),
    };
}

export default connect(mapStateToProps, mapDispatchToProps)(DataPrefetch);
