import * as _ from 'lodash';
import * as React from 'react';
import { connect } from 'react-redux';
import { Link } from 'react-router-dom';
import {
  NotificationDrawer,
  NotificationEntry,
  NotificationCategory,
  NotificationTypes,
} from '@console/patternfly';
import * as UIActions from '@console/internal/actions/ui';
import store, { RootState } from '@console/internal/redux';
import { Alert, alertURL } from '@console/internal/components/monitoring';
import {
  getAlertDescription,
  getAlertMessage,
  getAlertName,
  getAlertSeverity,
  getAlertTime,
  getAlerts,
} from '@console/shared/src/components/dashboard/status-card/alert-utils';
import {
  EmptyState,
  EmptyStateBody,
  EmptyStateSecondaryActions,
  EmptyStateVariant,
  Title,
} from '@patternfly/react-core';

import { coFetchJSON } from '../co-fetch';
import { FirehoseResult } from './utils';
import {
  ClusterUpdate,
  ClusterVersionKind,
  hasAvailableUpdates,
  K8sResourceKind,
} from '../module/k8s';
import { getSortedUpdates } from './modals/cluster-update-modal';

const emptyState = (toggleExpanded) => (
  <EmptyState variant={EmptyStateVariant.full} className="co-status-card__alerts-msg">
    <Title headingLevel="h5" size="lg">
      No critical alerts
    </Title>
    <EmptyStateBody>
      There are currently no critical alerts firing. There may be firing alerts of other severities
      or silenced critical alerts however.
    </EmptyStateBody>
    <EmptyStateSecondaryActions>
      <Link to="/monitoring/alerts" onClick={toggleExpanded}>
        View all alerts
      </Link>
    </EmptyStateSecondaryActions>
  </EmptyState>
);
const criticalCompare = (a): boolean => getAlertSeverity(a) === 'critical';
const otherAlertCompare = (a): boolean => getAlertSeverity(a) !== 'critical';

const getAlertNotificationEntries = (
  isLoaded,
  alertData,
  toggleNotificationDrawer,
  isCritical,
): React.ReactNode[] =>
  isLoaded && !_.isEmpty(alertData)
    ? alertData
        .filter((a) => (isCritical ? criticalCompare(a) : otherAlertCompare(a)))
        .map((alert) => (
          <NotificationEntry
            key={alert.activeAt}
            description={getAlertDescription(alert) || getAlertMessage(alert)}
            timestamp={getAlertTime(alert)}
            type={NotificationTypes[getAlertSeverity(alert)]}
            title={getAlertName(alert)}
            toggleNotificationDrawer={toggleNotificationDrawer}
            targetURL={alertURL(alert, alert.rule.id)}
          />
        ))
    : [];

const getUpdateNotificationEntries = (
  isLoaded,
  updateData,
  toggleNotificationDrawer,
): React.ReactNode[] =>
  isLoaded && !_.isEmpty(updateData)
    ? [
        <NotificationEntry
          key="cluster-udpate"
          description={updateData[0].version || 'Unknown'}
          type={NotificationTypes.update}
          title="Cluster update available"
          toggleNotificationDrawer={toggleNotificationDrawer}
          targetURL="/settings/cluster"
        />,
      ]
    : [];

export const ConnectedNotificationDrawer_: React.FC<ConnectedNotificationDrawerProps> = ({
  toggleNotificationDrawer,
  toggleNotificationsRead,
  isDrawerExpanded,
  notificationsRead,
  alerts,
  resources,
  children,
}) => {
  React.useEffect(() => {
    let pollerTimeout = null;
    const poll: NotificationPoll = (url, dataHandler) => {
      const key = 'notificationAlerts';
      store.dispatch(UIActions.monitoringLoading(key));
      const notificationPoller = (): void => {
        coFetchJSON(url)
          .then((response) => dataHandler(response))
          .then((data) => store.dispatch(UIActions.monitoringLoaded(key, data)))
          .catch((e) => store.dispatch(UIActions.monitoringErrored(key, e)))
          .then(() => (pollerTimeout = setTimeout(notificationPoller, 15 * 1000)));
      };
      notificationPoller();
    };
    const { prometheusBaseURL } = window.SERVER_FLAGS;

    if (prometheusBaseURL) {
      poll(`${prometheusBaseURL}/api/v1/rules`, getAlerts);
    } else {
      store.dispatch(
        UIActions.monitoringErrored('notificationAlerts', new Error('prometheusBaseURL not set')),
      );
    }
    return () => pollerTimeout.clearTimeout;
  }, []);
  const cv: ClusterVersionKind = _.get(resources.cv, 'data') as ClusterVersionKind;
  const cvLoaded: boolean = _.get(resources.cv, 'loaded');
  const updateData: ClusterUpdate[] = hasAvailableUpdates(cv) ? getSortedUpdates(cv) : [];
  const { data, loaded } = alerts;

  const updateList: React.ReactNode[] = getUpdateNotificationEntries(
    cvLoaded,
    updateData,
    toggleNotificationDrawer,
  );
  const criticalAlertList: React.ReactNode[] = getAlertNotificationEntries(
    true,
    loaded,
    data,
    toggleNotificationDrawer,
  );
  const otherAlertList: React.ReactNode[] = getAlertNotificationEntries(
    loaded,
    data,
    toggleNotificationDrawer,
    false,
  );
  const [isAlertExpanded, toggleAlertExpanded] = React.useState<boolean>(
    !_.isEmpty(criticalAlertList),
  );
  const [isNonCriticalAlertExpanded, toggleNonCriticalAlertExpanded] = React.useState<boolean>(
    false,
  );

  const criticalAlertType: React.ReactElement = (
    <NotificationCategory
      isExpanded={isAlertExpanded}
      label="Critical Alerts"
      count={criticalAlertList.length}
      onExpandContents={toggleAlertExpanded}
    >
      {_.isEmpty(criticalAlertList) ? emptyState(toggleNotificationDrawer) : criticalAlertList}
    </NotificationCategory>
  );
  const nonCriticalAlertType: React.ReactElement = !_.isEmpty(otherAlertList) ? (
    <NotificationCategory
      isExpanded={isNonCriticalAlertExpanded}
      label="Other Alerts"
      count={otherAlertList.length}
      onExpandContents={toggleNonCriticalAlertExpanded}
    >
      {otherAlertList}
    </NotificationCategory>
  ) : null;

  if (_.isEmpty(data) && _.isEmpty(updateList) && !notificationsRead) {
    toggleNotificationsRead();
  } else if ((!_.isEmpty(data) || !_.isEmpty(updateList)) && notificationsRead) {
    toggleNotificationsRead();
  }

  return (
    <NotificationDrawer
      isExpanded={isDrawerExpanded}
      notificationEntries={[criticalAlertType, nonCriticalAlertType]}
      count={criticalAlertList.length + otherAlertList.length}
    >
      {children}
    </NotificationDrawer>
  );
};

type NotificationPoll = (url: string, dataHandler: (data) => any) => void;

export type WithNotificationsProps = {
  isDrawerExpanded: boolean;
  notificationsRead: boolean;
  alerts: {
    data: Alert[];
    loaded: boolean;
    loadError?: string;
  };
};

export type ConnectedNotificationDrawerProps = {
  toggleNotificationsRead: () => any;
  toggleNotificationDrawer: () => any;
  isDrawerExpanded: boolean;
  notificationsRead: boolean;
  alerts: {
    data: Alert[];
    loaded: boolean;
    loadError?: string;
  };
  resources?: {
    [key: string]: FirehoseResult | FirehoseResult<K8sResourceKind>;
  };
};

const notificationStateToProps = ({ UI }: RootState): WithNotificationsProps => ({
  isDrawerExpanded: !!UI.getIn(['notifications', 'isExpanded']),
  notificationsRead: !!UI.getIn(['notifications', 'isRead']),
  alerts: UI.getIn(['monitoring', 'notificationAlerts']) || {},
});

const connectToNotifications = connect((state: RootState) => notificationStateToProps(state), {
  toggleNotificationDrawer: UIActions.notificationDrawerToggleExpanded,
  toggleNotificationsRead: UIActions.notificationDrawerToggleRead,
});
export const ConnectedNotificationDrawer = connectToNotifications(ConnectedNotificationDrawer_);
