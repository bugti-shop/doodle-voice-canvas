import { useTranslation } from 'react-i18next';
import { m as motion } from 'framer-motion';
import { Crown, Gift, Calendar, Clock, ChevronRight } from 'lucide-react';
import { useSubscription } from '@/contexts/SubscriptionContext';

const ENTITLEMENT_ID = 'npd Pro';

export const ProfileSubscriptionCard = () => {
  const { t } = useTranslation();
  const { isPro, planType, customerInfo, openPaywall, restorePurchases } = useSubscription();

  // Extract subscription details from RevenueCat customerInfo
  const entitlement = customerInfo?.entitlements?.active?.[ENTITLEMENT_ID];
  const isTrialing = entitlement?.periodType === 'TRIAL' || entitlement?.periodType === 'trial';
  const expirationDate = entitlement?.expirationDate ? new Date(entitlement.expirationDate) : null;
  const purchaseDate = entitlement?.latestPurchaseDate ? new Date(entitlement.latestPurchaseDate) : null;
  const willRenew = entitlement?.willRenew ?? false;

  const formatDate = (date: Date | null) => {
    if (!date) return '—';
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const getPlanLabel = () => {
    if (!isPro) return t('profile.freePlan', 'Free');
    if (isTrialing) return t('profile.trialPlan', 'Free Trial');
    switch (planType) {
      case 'weekly': return t('profile.weeklyPlan', 'Weekly');
      case 'monthly': return t('profile.monthlyPlan', 'Monthly');
      case 'yearly': return t('profile.yearlyPlan', 'Yearly');
      default: return t('profile.proPlan', 'Pro');
    }
  };

  const getDaysRemaining = () => {
    if (!expirationDate) return null;
    const now = new Date();
    const diff = expirationDate.getTime() - now.getTime();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  };

  const daysRemaining = getDaysRemaining();

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full rounded-2xl border border-border/50 overflow-hidden bg-card"
    >
      {/* Header */}
      <div className={`px-4 py-3 flex items-center gap-3 ${isPro ? 'bg-primary/10' : 'bg-muted/50'}`}>
        <div className={`w-9 h-9 rounded-full flex items-center justify-center ${isPro ? 'bg-primary/20' : 'bg-muted'}`}>
          {isPro ? (
            isTrialing ? <Gift className="h-4.5 w-4.5 text-primary" /> : <Crown className="h-4.5 w-4.5 text-primary" />
          ) : (
            <Crown className="h-4.5 w-4.5 text-muted-foreground" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">{getPlanLabel()}</p>
          <p className="text-xs text-muted-foreground">
            {isPro
              ? isTrialing
                ? t('profile.trialActive', 'Trial is active')
                : t('profile.subscriptionActive', 'Subscription active')
              : t('profile.noSubscription', 'No active subscription')}
          </p>
        </div>
        {isPro && (
          <span className="px-2.5 py-1 text-[10px] font-bold uppercase rounded-full bg-primary/15 text-primary tracking-wide">
            {isTrialing ? t('profile.trial', 'Trial') : t('profile.pro', 'PRO')}
          </span>
        )}
      </div>

      {/* Details */}
      <div className="px-4 py-3 space-y-2.5">
        {isPro && expirationDate && (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="h-3.5 w-3.5" />
                <span className="text-xs">
                  {isTrialing
                    ? t('profile.trialEnds', 'Trial ends')
                    : willRenew
                      ? t('profile.renewsOn', 'Renews on')
                      : t('profile.expiresOn', 'Expires on')}
                </span>
              </div>
              <span className="text-xs font-medium text-foreground">{formatDate(expirationDate)}</span>
            </div>

            {daysRemaining !== null && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  <span className="text-xs">{t('profile.daysRemaining', 'Days remaining')}</span>
                </div>
                <span className={`text-xs font-medium ${daysRemaining <= 3 ? 'text-destructive' : 'text-foreground'}`}>
                  {daysRemaining} {t('profile.days', 'days')}
                </span>
              </div>
            )}

            {purchaseDate && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5" />
                  <span className="text-xs">{t('profile.startedOn', 'Started on')}</span>
                </div>
                <span className="text-xs font-medium text-foreground">{formatDate(purchaseDate)}</span>
              </div>
            )}
          </>
        )}

        {/* Action button */}
        {!isPro ? (
          <button
            onClick={() => openPaywall()}
            className="w-full flex items-center justify-between px-3 py-2.5 mt-1 rounded-xl bg-primary/10 hover:bg-primary/15 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Crown className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-primary">{t('profile.upgradeToPro', 'Upgrade to Pro')}</span>
            </div>
            <ChevronRight className="h-4 w-4 text-primary" />
          </button>
        ) : (
          <button
            onClick={() => restorePurchases()}
            className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors py-1.5"
          >
            {t('profile.restorePurchases', 'Restore Purchases')}
          </button>
        )}
      </div>
    </motion.div>
  );
};
