import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Crown, Unlock, Bell, Loader2, Gift, Check } from 'lucide-react';
import { useSubscription, ProductType } from '@/contexts/SubscriptionContext';
import { Capacitor } from '@capacitor/core';
import { Purchases, PurchasesPackage, PACKAGE_TYPE } from '@revenuecat/purchases-capacitor';
import { triggerHaptic } from '@/utils/haptics';
import { useHardwareBackButton } from '@/hooks/useHardwareBackButton';
import { setSetting } from '@/utils/settingsStorage';

// Fallback prices (USD) used only when RevenueCat offerings aren't available (e.g. web)
const FALLBACK_PLANS = [
  { id: 'weekly' as ProductType, label: 'Weekly', price: '$1.99/wk', badge: null, hasTrial: false },
  { id: 'monthly' as ProductType, label: 'Monthly', price: '$5.99/mo', badge: 'Popular', hasTrial: true },
  { id: 'yearly' as ProductType, label: 'Yearly', price: '$39.99/yr', badge: 'Best Value', hasTrial: true },
] as const;

const PERIOD_LABELS: Record<string, string> = {
  weekly: '/wk',
  monthly: '/mo',
  yearly: '/yr',
};

export const PremiumPaywall = () => {
  const { t } = useTranslation();
  const { showPaywall, closePaywall, unlockPro, purchase, offerings } = useSubscription();
  const [selectedPlan, setSelectedPlan] = useState<ProductType>('monthly');
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [adminCode, setAdminCode] = useState('');
  const [showAdminInput, setShowAdminInput] = useState(false);
  const [adminError, setAdminError] = useState('');

  // Build plans from RevenueCat offerings with localized prices
  const PLANS = useMemo(() => {
    const allPackages: PurchasesPackage[] = [];
    if (offerings?.current?.availablePackages) {
      allPackages.push(...offerings.current.availablePackages);
    }
    if (offerings?.all) {
      Object.values(offerings.all).forEach((offering: any) => {
        offering?.availablePackages?.forEach((p: PurchasesPackage) => {
          if (!allPackages.find(e => e.identifier === p.identifier)) {
            allPackages.push(p);
          }
        });
      });
    }

    const findPrice = (type: ProductType): string | null => {
      const typeMap: Record<ProductType, PACKAGE_TYPE> = {
        weekly: PACKAGE_TYPE.WEEKLY,
        monthly: PACKAGE_TYPE.MONTHLY,
        yearly: PACKAGE_TYPE.ANNUAL,
      };
      const pkg = allPackages.find(p => p.packageType === typeMap[type]);
      const product = pkg?.product;
      if (product?.priceString) {
        return `${product.priceString}${PERIOD_LABELS[type] || ''}`;
      }
      return null;
    };

    return FALLBACK_PLANS.map(plan => ({
      ...plan,
      price: findPrice(plan.id) || plan.price,
    }));
  }, [offerings]);

  useHardwareBackButton({
    onBack: () => { closePaywall(); },
    enabled: showPaywall,
    priority: 'sheet',
  });

  if (!showPaywall) return null;

  const currentPlan = PLANS.find(p => p.id === selectedPlan)!;

  const handlePurchase = async () => {
    setIsPurchasing(true);
    setAdminError('');
    try {
      if (Capacitor.isNativePlatform()) {
        const success = await purchase(selectedPlan);
        if (success) {
          closePaywall();
        } else {
          setAdminError('Purchase was cancelled or failed. Please try again.');
          setTimeout(() => setAdminError(''), 4000);
        }
      } else {
        await unlockPro();
      }
    } catch (error: any) {
      if (error.code !== 'PURCHASE_CANCELLED' && !error.userCancelled) {
        console.error('Purchase failed:', error);
        setAdminError(`Purchase failed: ${error.message || 'Please try again.'}`);
        setTimeout(() => setAdminError(''), 5000);
      }
    } finally {
      setIsPurchasing(false);
    }
  };

  const handleRestore = async () => {
    setIsRestoring(true);
    try {
      if (Capacitor.isNativePlatform()) {
        const { customerInfo } = await Purchases.restorePurchases();
        const hasEntitlement = customerInfo.entitlements.active['npd Pro'] !== undefined;
        if (hasEntitlement) {
          await unlockPro();
          closePaywall();
        } else {
          setAdminError('No active purchases found. If you believe this is an error, please contact support.');
          setTimeout(() => setAdminError(''), 4000);
        }
      } else {
        setAdminError('Restore is only available on mobile devices');
        setTimeout(() => setAdminError(''), 3000);
      }
    } catch (error: any) {
      console.error('Restore failed:', error);
      setAdminError(error?.message || 'Restore failed. Please try again.');
      setTimeout(() => setAdminError(''), 4000);
    } finally {
      setIsRestoring(false);
    }
  };

  const handleAccessCode = async () => {
    const validCode = 'BUGTI';
    if (adminCode.trim().toUpperCase() === validCode) {
      await setSetting('flowist_admin_bypass', true);
      await unlockPro();
    } else {
      setAdminError('Invalid access code');
      setAdminCode('');
    }
  };

  return (
    <div className="fixed inset-0 z-[200] bg-white flex flex-col" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)', paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 24px)' }}>
      {/* Close button */}
      <div className="flex justify-end px-4 py-2">
        <button onClick={closePaywall} className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
          <X className="h-5 w-5 text-gray-600" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6">
        <h1 className="text-3xl font-bold text-center mb-6">{t('onboarding.paywall.upgradeTitle')}</h1>
        
        {/* Feature timeline */}
        <div className="flex flex-col items-start mx-auto w-80 relative">
          <div className="absolute left-[10.5px] top-[20px] bottom-[20px] w-[11px] bg-primary/20 rounded-b-full"></div>

           <div className="flex items-start gap-3 mb-6 relative">
             <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground z-10 flex-shrink-0">
               <Unlock size={16} strokeWidth={2} />
             </div>
             <div>
               <p className="font-semibold">{t('onboarding.paywall.unlockAllFeatures')}</p>
               <p className="text-muted-foreground text-sm">{t('onboarding.paywall.unlockAllFeaturesDesc')}</p>
             </div>
           </div>
           <div className="flex items-start gap-3 mb-6 relative">
             <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground z-10 flex-shrink-0">
               <Bell size={16} strokeWidth={2} />
             </div>
             <div>
               <p className="font-semibold">{t('onboarding.paywall.unlimitedEverything')}</p>
               <p className="text-muted-foreground text-sm">{t('onboarding.paywall.unlimitedEverythingDesc')}</p>
             </div>
           </div>
           <div className="flex items-start gap-3 mb-6 relative">
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground z-10 flex-shrink-0">
                <Crown size={16} strokeWidth={2} />
              </div>
              <div>
                <p className="font-semibold">{t('onboarding.paywall.proMember')}</p>
                <p className="text-muted-foreground text-sm">{t('onboarding.paywall.proMemberDesc')}</p>
              </div>
            </div>
            {(selectedPlan === 'monthly' || selectedPlan === 'yearly') && (
              <div className="flex items-start gap-3 mb-6 relative">
                <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground z-10 flex-shrink-0">
                  <Gift size={16} strokeWidth={2} />
                </div>
                <div>
                  <p className="font-semibold">3 Days Free Trial</p>
                  <p className="text-muted-foreground text-sm">Try all Pro features free for 3 days</p>
                </div>
              </div>
            )}
        </div>

        {/* Plan selection */}
        <div className="mt-10 flex flex-col items-center gap-4">
          <div className="flex gap-3 w-full max-w-sm">
            {PLANS.map((plan) => (
              <button
                key={plan.id}
                onClick={() => setSelectedPlan(plan.id)}
                className={`flex-1 relative rounded-xl p-3 text-center border-2 transition-all ${
                  selectedPlan === plan.id 
                    ? 'border-primary bg-secondary' 
                    : 'border-muted bg-white'
                }`}
              >
                {plan.badge && (
                  <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[10px] font-bold bg-primary text-primary-foreground px-2 py-0.5 rounded-full whitespace-nowrap">
                    {plan.badge}
                  </span>
                )}
                <p className="font-bold text-sm">{plan.label}</p>
                <p className="text-muted-foreground text-xs mt-1">{plan.price}</p>
                {selectedPlan === plan.id && (
                  <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                    <Check size={10} className="text-primary-foreground" />
                  </div>
                )}
              </button>
            ))}
          </div>

          <div className="flex flex-col items-center gap-2">
            {/* Dynamic offer text above button */}
            {currentPlan.hasTrial && (
              <p className="text-foreground font-semibold text-base text-center mt-4">
                3 Days Free, then {currentPlan.price}
              </p>
            )}

            <button 
              onClick={handlePurchase}
              disabled={isPurchasing}
              className="w-80 mt-2 btn-duo disabled:opacity-50"
            >
              {isPurchasing 
                ? t('onboarding.paywall.processing') 
                : currentPlan.hasTrial 
                  ? 'Try for $0.00 Today'
                  : `Continue with ${currentPlan.price}`}
            </button>

            {adminError && (
              <p className="text-destructive text-xs mt-1">{adminError}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
