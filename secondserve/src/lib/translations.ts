export interface TranslationKeys {
  appName: string;
  meals: string;
  login: string;
  signup: string;
  myProfile: string;
  logout: string;
  logoutConfirmTitle: string;
  logoutConfirmMsg: string;
  confirm: string;
  cancel: string;
  filterByCity: string;
  allCities: string;
  casablanca: string;
  mohammedia: string;
  searchPlaceholder: string;
  noProductsFound: string;
  resetFilters: string;
  category: string;
  type: string;
  categoryAll: string;
  bakedGoods: string;
  produce: string;
  preparedMeals: string;
  patisserie: string;
  superette: string;
  buffet: string;
  supermarket: string;
  surpriseBox: string;
  distanceKm: string;
  getDirections: string;
  orderNow: string;
  originalPrice: string;
  reducedPrice: string;
  quantityLeft: string;
  reviewsCount: string;

  // Checkout Form
  checkoutDetails: string;
  fullNameLabel: string;
  fullNamePlaceholder: string;
  phoneLabel: string;
  phonePlaceholder: string;
  optionalMsgLabel: string;
  optionalMsgPlaceholder: string;
  realtimeSyncNote: string;
  realtimeSyncDesc: string;
  continueBtn: string;
  checkoutStepTitle: string;
  checkoutStepOf: string;

  // Settlement Choice
  settlementMethod: string;
  selectSettlementDesc: string;
  payOnlineTitle: string;
  payOnlineDesc: string;
  escrowBadge: string;
  payDeliveryTitle: string;
  payDeliveryDesc: string;
  backToDetails: string;

  // Credit Card Form
  cardInfo: string;
  cardInfoDesc: string;
  cardNumberLabel: string;
  cardExpiryLabel: string;
  cardCvvLabel: string;
  bankName: string;
  simulateDeclineLabel: string;
  simulateDeclineDesc: string;
  declineStatus: string;
  approvedStatus: string;
  authorizePaymentBtn: string;
  processingMsgTitle: string;
  processingMsgDesc: string;

  // Checkout Success
  orderPlacedSuccess: string;
  orderPlacedDesc: string;
  escrowHoldTitle: string;
  escrowHoldDesc: string;
  deliveryPaymentTitle: string;
  deliveryPaymentDesc: string;
  pickupLocationTitle: string;
  openGpsDirections: string;
  returnMarketplace: string;

  // Notifications
  newOrderAlertTitle: string;
  newOrderAlertDesc: string;
  bellTooltip: string;
  noNotifications: string;
  orderPlacedBy: string;
  amountLabel: string;
  paymentLabel: string;
  notifMethodOnline: string;
  notifMethodCash: string;

  // Consumer Dashboard
  consumerDashboardTitle: string;
  myOrdersTab: string;
  myFavoritesTab: string;
  profileSettingsTab: string;
  noOrdersYet: string;
  orderStatusActive: string;
  orderStatusCompleted: string;
  orderStatusCancelled: string;
  cancelOrderBtn: string;
  rateAndReviewTitle: string;
  reviewCommentPlaceholder: string;
  submitReviewBtn: string;
  orderDateLabel: string;

  // Partner Dashboard
  partnerDashboardTitle: string;
  myProductsTab: string;
  manageProductsHeader: string;
  customerOrdersTab: string;
  partnerProfileTab: string;
  partnerReviewsTab: string;
  addProductBtn: string;
  editProductBtn: string;
  deleteProductBtn: string;
  confirmDeliveryBtn: string;
  cashPaymentNotice: string;
  escrowNoticeReleased: string;
  escrowNoticeHeld: string;
  customerMessageTitle: string;
  noReviewsYet: string;

  // Product Add/Edit Dialog
  productFormTitleAdd: string;
  productFormTitleEdit: string;
  inputTitle: string;
  inputDescription: string;
  inputImageUrl: string;
  timeLimitLabel: string;
  preciseCoordinatesLabel: string;
  autoDetectBtn: string;
  detectingBtn: string;
  saveChangesBtn: string;

  // Partner Profile Settings
  businessSettingsTitle: string;
  businessNameLabel: string;
  businessAddressLabel: string;
  contactMailLabel: string;
  contactPhoneLabel: string;
  coordinatesLabel: string;
  saveProfileBtn: string;
  howWeUseLocation: string;
  gpsSafetySystem: string;
  enablePreciseLocation: string;
  noThanksManual: string;
  grantAutoDetect: string;

  // Home Page Additional
  homeHeroSub: string;
  homeHeroCTA: string;
  statsRescued: string;
  statsCo2: string;
  statsActivePartners: string;
  statsRescuedLabel: string;
  statsCo2Label: string;
  statsPartnersLabel: string;
  geolocationPermissionRequired: string;
  geolocationPermissionDeclined: string;
  geolocationPositionUnavailable: string;
  geolocationTimeout: string;
  geolocationUnsecureWarning: string;
  geolocationSuccess: string;
  categoryOther: string;
  gpsAcquiringSignal: string;
  clearGpsMode: string;
  autoDetectLocationBanner: string;
  autoDetectExplanation: string;

  // Auth page
  authWelcomeBack: string;
  authJoinUs: string;
  authLoginSub: string;
  authSignupSub: string;
  authTabLogin: string;
  authTabSignup: string;
  authRoleConsumer: string;
  authRoleBusiness: string;
  authFullName: string;
  authBusinessName: string;
  authFullNamePh: string;
  authBusinessNamePh: string;
  authBusinessType: string;
  authEmailLabel: string;
  authEmailPh: string;
  authPhoneLabel: string;
  authPhonePh: string;
  authCityLabel: string;
  authSecretCode: string;
  authSecretCodePh: string;
  authFullAddress: string;
  authFullAddressPh: string;
  authPasswordLabel: string;
  authRememberMe: string;
  authLoginBtn: string;
  authSignupBtn: string;
  authSigningIn: string;
  authRegistering: string;
  authToastWelcomeBack: string;
  authToastConsumerCreated: string;
  authToastPartnerPending: string;
  authToastSuspended: string;
  authErrEmailInvalid: string;
  authErrPasswordWeak: string;
  authErrSecretInvalid: string;
  authErrBusinessTypeInvalid: string;
  authErrInvalidCreds: string;
  authErrTooManyAttempts: string;
  authErrEmailInUse: string;
  authErrWeakPassword: string;
  authErrLoginGeneric: string;
  authErrSignupGeneric: string;
  authErrFarmerBlocked: string;

  // Footer
  footerTagline: string;
  footerQuickLinks: string;
  footerTodaysOffers: string;
  footerHowItWorks: string;
  footerBecomePartner: string;
  footerExplorePartners: string;
  footerContact: string;
  footerLocationMorocco: string;
  footerPrivacyPolicy: string;
  footerTerms: string;
  footerPrivacyToast: string;
  footerTermsToast: string;
  footerEmailCopiedToast: string;
  footerCopyright: string;

  // City selector modal
  citySelectorTitle: string;
  citySelectorDesc: string;
  citySelectorComingSoon: string;

  // Location permission modal extras
  locModalConsumerB1Title: string;
  locModalConsumerB1Desc: string;
  locModalConsumerB2Title: string;
  locModalConsumerB2Desc: string;
  locModalConsumerB3Title: string;
  locModalConsumerB3Desc: string;
  locModalPartnerB1Title: string;
  locModalPartnerB1Desc: string;
  locModalPartnerB2Title: string;
  locModalPartnerB2Desc: string;
  locModalPartnerB3Title: string;
  locModalPartnerB3Desc: string;
  locModalInsecureTitle: string;
  locModalInsecureDesc: string;
  locModalSecureNote: string;
  locModalCloseAria: string;

  // Dashboard labels
  labelFullName: string;
  labelEmail: string;
  labelCity: string;
  labelPhoneNumber: string;
  labelStreetAddress: string;
  labelLatitude: string;
  labelLongitude: string;
  labelBusinessName: string;
  labelBusinessTypeStrict: string;
  labelPhone: string;
  labelMealName: string;
  labelMealCategory: string;
  labelDescription: string;
  labelOriginalPriceMAD: string;
  labelDiscountedPriceMAD: string;
  labelAvailableQuantity: string;
  labelCollectionDeadline: string;
  labelImageUpload: string;
  labelPartnerLocationStrict: string;
  labelInteractiveLocation: string;

  // Confirm modals
  confirmYes: string;
  confirmSaveChangesTitle: string;
  confirmSaveProfileMsg: string;
  confirmUpdateProductTitle: string;
  confirmPublishProductTitle: string;
  confirmUpdateProductMsg: string;
  confirmPublishProductMsg: string;

  // Pickup receipt + flow
  receiptPageTitle: string;
  receiptPickupCodeLabel: string;
  receiptShowCodeNote: string;
  receiptOrderRef: string;
  receiptPlacedAt: string;
  receiptPickupBy: string;
  receiptExpired: string;
  receiptStatusBadgeActive: string;
  receiptStatusBadgeCompleted: string;
  receiptStatusBadgeCancelled: string;
  receiptItemsSection: string;
  receiptPartnerSection: string;
  receiptTotalLabel: string;
  receiptCallPartner: string;
  receiptViewMap: string;
  receiptCancelBtn: string;
  receiptBackToDashboard: string;
  receiptNotFound: string;
  receiptNotAuthorized: string;
  viewReceiptBtn: string;
  pickupCodeTitle: string;
  pickupCodeEnterPrompt: string;
  pickupCodePlaceholder: string;
  pickupCodeConfirmBtn: string;
  pickupCodeInvalid: string;
  pickupCodeCancelBtn: string;
  orderExpiredBadge: string;
  orderExpiredHint: string;
  countdownExpiresIn: string;
  countdownExpired: string;
  cancelOrderConfirmMsg: string;

  // Navbar notifications dropdown
  realtimeOrdersHeading: string;
  clearAllNotifBtn: string;
  notificationsClearedToast: string;

  // AppContext toasts
  suspendedAccountToast: string;
  farmerBlockedToast: string;
  loginToFavoriteToast: string;
  loginToOrderToast: string;
  qtyNotAvailableToast: string;
  offerGoneToast: string;
  placeOrderGenericErrToast: string;
  cancelOrderErrToast: string;
  orderCancelledToast: string;
  paymentAlreadyConfirmedToast: string;
  notCodOrderToast: string;
  confirmPaymentGenericErrToast: string;
  cashConfirmedToast: string;
  /** {amount} placeholder, replaced at call site */
  paymentReleasedToast: string;
  updateOrderErrToast: string;
  /** {status} placeholder, replaced at call site */
  orderMarkedAsToast: string;
  reviewSubmitErrToast: string;
  reviewSubmittedToast: string;
  notificationsClearedBangToast: string;
  banUserErrToast: string;
  userBannedToast: string;
  unbanUserErrToast: string;
  userUnbannedToast: string;
  deleteUserErrToast: string;
  userDeletedToast: string;
  approvePartnerErrToast: string;
  partnerApprovedToast: string;
  rejectPartnerErrToast: string;
  partnerRejectedToast: string;
  addTicketErrToast: string;
  ticketSubmittedToast: string;
  resolveTicketErrToast: string;
  ticketResolvedToast: string;

  // OfferCard checkout validation
  errNameAndPhoneRequired: string;
  errInvalidCardNumber: string;
  errInvalidExpiry: string;
  errInvalidCvv: string;
  paymentDeclinedToast: string;
  paymentSuccessEscrowToast: string;
  cashOrderPlacedToast: string;
  transactionDeclinedError: string;

  // Consumer Dashboard sidebar nav + support tab
  navMyOrders: string;
  navFavorites: string;
  navHelpSupport: string;
  navSettings: string;
  fillAllFieldsToast: string;
  submitSupportRequestBtn: string;
  subjectLabel: string;
  subjectPlaceholder: string;
  descriptionLabel: string;
  descriptionPlaceholder: string;
  submitTicketBtn: string;
  ticketHistoryHeading: string;
  noTicketsMsg: string;
  ticketResolvedBadge: string;
  ticketPendingBadge: string;
  adminSolutionLabel: string;

  // Restaurant Dashboard extras
  offersNotVisibleYet: string;
  pendingApprovalReason: string;
  setCommerceTypeReason: string;
  openBusinessProfileBtn: string;
  viewFullDetailsBtn: string;
  businessHelpSupportHeading: string;
  subjectPlaceholderBiz: string;
  descriptionPlaceholderBiz: string;
  ticketHistoryHeadingBiz: string;
  noTicketsMsgBiz: string;
}

export const translations: { en: TranslationKeys; ar: TranslationKeys; fr: TranslationKeys } = {
  en: {
    appName: "SecondServe",
    meals: "Meals & Offers",
    login: "Log In",
    signup: "Sign Up",
    myProfile: "My Profile",
    logout: "Logout",
    logoutConfirmTitle: "Logout Confirmation",
    logoutConfirmMsg: "Are you sure you want to log out of your session?",
    confirm: "Confirm",
    cancel: "Cancel",
    filterByCity: "Select City",
    allCities: "All Cities",
    casablanca: "Casablanca",
    mohammedia: "Mohammedia",
    searchPlaceholder: "Search fresh surplus sweets, meals or groceries...",
    noProductsFound: "No products fit these search filters. Try selecting a different city or clearing query.",
    resetFilters: "Reset Filters",
    category: "Meal Category",
    type: "Commerce Type",
    categoryAll: "All",
    bakedGoods: "Baked Goods & Pastries",
    produce: "Fresh Produce",
    preparedMeals: "Prepared Meals",
    patisserie: "Patisserie",
    superette: "Superette",
    buffet: "Buffet à volonté",
    supermarket: "Supermarket & Grocer",
    surpriseBox: "Surprise Box Only",
    distanceKm: "km adjacent",
    getDirections: "View Location Info",
    orderNow: "Order / Reserve Now",
    originalPrice: "Original Price",
    reducedPrice: "Reduced Price",
    quantityLeft: "items left",
    reviewsCount: "reviews",

    // Checkout Form
    checkoutDetails: "Customer Information",
    fullNameLabel: "Full Name",
    fullNamePlaceholder: "e.g. Jane Doe",
    phoneLabel: "Phone Number",
    phonePlaceholder: "e.g. 06 12 34 56 78",
    optionalMsgLabel: "Optional message or notes to partner",
    optionalMsgPlaceholder: "e.g. I will pick it up around 19:30, please keep it refrigerated.",
    realtimeSyncNote: "Immediate Real-time Synchronization",
    realtimeSyncDesc: "Your physical coordinates are matched, and your order instantly alerts the partner's workstation dashboard upon submission.",
    continueBtn: "Continue to Payment Options",
    checkoutStepTitle: "Consumer Details",
    checkoutStepOf: "Step 1 of 3",

    // Settlement Choice
    settlementMethod: "Settlement Method",
    selectSettlementDesc: "Select how you would like to settle the total amount of",
    payOnlineTitle: "💳 Pay Securely Online Now",
    payOnlineDesc: "Authorize instantly using a protected dummy banking card. Funds are safely kept in trust escrow and are only released to the Partner after order completion!",
    escrowBadge: "Safe Escrow",
    payDeliveryTitle: "🤝 Pay on Delivery / Pay at Partner",
    payDeliveryDesc: "Reserve the item instantly without paying online. Pay physically in cash or card when picking up at the partner's physical location.",
    backToDetails: "Back to Details",

    // Credit Card Form
    cardInfo: "Card Information",
    cardInfoDesc: "Enter valid parameters to authorize the total payload of",
    cardNumberLabel: "Debit / Credit Card Number",
    cardExpiryLabel: "Expiration Date (MM/YY)",
    cardCvvLabel: "Security Code (CVV)",
    bankName: "SecondServe Trust Gateway",
    simulateDeclineLabel: "Simulate Card Decline",
    simulateDeclineDesc: "Enable to test how the system rejects denied bank signals.",
    declineStatus: "SIMULATION: DECLINE",
    approvedStatus: "SIMULATION: APPROVED",
    authorizePaymentBtn: "Authorize Complete Online Payment",
    processingMsgTitle: "Securing Transaction...",
    processingMsgDesc: "Communicating with card-issuer bank server and storing secure trust escrows...",

    // Checkout Success
    orderPlacedSuccess: "Order Successfully Placed!",
    orderPlacedDesc: "Your purchase details have been securely synchronized directly with",
    escrowHoldTitle: "Funds Held Safely in Escrow (Successful)",
    escrowHoldDesc: "Our platform is holding your payment. It will be released automatically to the Partner once they confirm fulfillment at the store.",
    deliveryPaymentTitle: "Storefront Payment Method Recognized",
    deliveryPaymentDesc: "No charge has been made. Please prepare cash or phone card scan options to pay directly at the physical location.",
    pickupLocationTitle: "Pickup Storefront Location",
    openGpsDirections: "Open GPS Road Directions",
    returnMarketplace: "Return to Marketplace & Offers",

    // Notifications
    newOrderAlertTitle: "🚨 New Instant Order! 🚨",
    newOrderAlertDesc: "Your shop received a real-time order! Check customer details, product requested and payment details.",
    bellTooltip: "Unread Notifications",
    noNotifications: "No new notifications",
    orderPlacedBy: "received an order from",
    amountLabel: "Total:",
    paymentLabel: "Method:",
    notifMethodOnline: "Paid Online (Escrow)",
    notifMethodCash: "Pay on Delivery (Cash)",

    // Consumer Dashboard
    consumerDashboardTitle: "Consumer Dashboard",
    myOrdersTab: "My Orders & History",
    myFavoritesTab: "My Favorites",
    profileSettingsTab: "Profile & Map Location",
    noOrdersYet: "No orders placed yet. Experience fresh goods from local sellers!",
    orderStatusActive: "Pending Pickup",
    orderStatusCompleted: "Completed",
    orderStatusCancelled: "Cancelled",
    cancelOrderBtn: "Cancel Order",
    rateAndReviewTitle: "Rate & Review Your Surprise Box",
    reviewCommentPlaceholder: "Your thoughts on freshness, taste, and quantity of this box...",
    submitReviewBtn: "Submit Review",
    orderDateLabel: "Placed on",

    // Partner Dashboard
    partnerDashboardTitle: "Chef & Partner Workstation",
    myProductsTab: "My Surplus Items",
    manageProductsHeader: "Manage Active Surplus Offers",
    customerOrdersTab: "Customer Orders (Real-time)",
    partnerProfileTab: "Business Map Profile",
    partnerReviewsTab: "Customer Reviews",
    addProductBtn: "Add Surplus Offer",
    editProductBtn: "Edit Info",
    deleteProductBtn: "Delete",
    confirmDeliveryBtn: "Confirm Delivery & Unlock Funds",
    cashPaymentNotice: "🤝 Storefront checkout chosen. Collect payment in full directly at pickup time.",
    escrowNoticeReleased: "🟢 Funds have been securely released to your storefront balance.",
    escrowNoticeHeld: "⏳ Funds held in escrow. Will automatically release to you upon tapping \"Confirm Delivery\".",
    customerMessageTitle: "Optional Customer Message Note:",
    noReviewsYet: "No ratings or reviews received yet. Expose items to gather feedback!",

    // Product Add/Edit Dialog
    productFormTitleAdd: "Publish New Surplus Offer",
    productFormTitleEdit: "Modify Active Surprise Offer",
    inputTitle: "Offer Name / Surprise Box Title",
    inputDescription: "Description of what is included",
    inputImageUrl: "Product Image URL Asset",
    timeLimitLabel: "Order Expiry Pick-up Time",
    preciseCoordinatesLabel: "Storefront GPS Coordinates (Required for Map Display)",
    autoDetectBtn: "Autodetect GPS Location",
    detectingBtn: "Scanning GPS...",
    saveChangesBtn: "Save Offer Info",

    // Partner Profile Settings
    businessSettingsTitle: "Partner Business Map Profile",
    businessNameLabel: "Business / Shop Name",
    businessAddressLabel: "Physical Shop Street Address",
    contactMailLabel: "Contact Email Address",
    contactPhoneLabel: "Work Phone Number",
    coordinatesLabel: "Storefront GPS Coordinates",
    saveProfileBtn: "Update Business Profile & Save Coordinates",
    howWeUseLocation: "Why SecondServe requests location access:",
    gpsSafetySystem: "GPS Safety System",
    enablePreciseLocation: "Enable Precise Location Access",
    noThanksManual: "No thanks, type manually",
    grantAutoDetect: "Grant & Auto Detect GPS",

    // Home Page Additional
    homeHeroSub: "Rescue premium baked pastries, delicious prepared meals, or grocery surplus before the day finishes. Delicious, sustainable, and 70% cheaper in Morocco.",
    homeHeroCTA: "Discover Surplus Meals Near You",
    statsRescued: "14,250+",
    statsCo2: "35,620 kg",
    statsActivePartners: "240+",
    statsRescuedLabel: "Meals Saved",
    statsCo2Label: "CO2 Emissions Reduced",
    statsPartnersLabel: "Active Partners",
    geolocationPermissionRequired: "Browser location permission is required. To calculate the physical road distance (in km) to Casablanca food vendors, location permissions are necessary.",
    geolocationPermissionDeclined: "Please allow location access in your browser or device settings to calculate exact storefront distance. 📍",
    geolocationPositionUnavailable: "Position unavailable. Local GPS hardware or network signal could not determine location. Casablanca center (33.5731, -7.5898) is used as a fallback.",
    geolocationTimeout: "Authorization request timed out. Please click retry to synchronize again.",
    geolocationUnsecureWarning: "Warning: Platform is not running on a secure HTTPS connection. Geolocation APIs may fail or degrade unless running on localhost.",
    geolocationSuccess: "GPS coordinates successfully synchronized! Product road distances and sorting order updated instantly.",
    categoryOther: "Other",
    gpsAcquiringSignal: "Acquiring GPS Signal...",
    clearGpsMode: "Reset GPS Mode",
    autoDetectLocationBanner: "Find Meals Right Next To You 📍",
    autoDetectExplanation: "We use your browser's native Geolocation API to instantly calculate exact road distances (in km) to Casablanca & Mohammedia vendors, ensuring you grab the target surplus before they expire.",

    // Auth page
    authWelcomeBack: "Welcome back!",
    authJoinUs: "Join us",
    authLoginSub: "Log in to save meals.",
    authSignupSub: "Create an account to start fighting food waste.",
    authTabLogin: "Login",
    authTabSignup: "Sign Up",
    authRoleConsumer: "Consumer",
    authRoleBusiness: "Business",
    authFullName: "Full Name",
    authBusinessName: "Business Name",
    authFullNamePh: "John Doe",
    authBusinessNamePh: "My Restaurant",
    authBusinessType: "Business Type",
    authEmailLabel: "Email",
    authEmailPh: "you@example.com",
    authPhoneLabel: "Phone Number",
    authPhonePh: "06 00 00 00 00",
    authCityLabel: "City",
    authSecretCode: "Secret Code",
    authSecretCodePh: "Enter business secret code",
    authFullAddress: "Full Address",
    authFullAddressPh: "123 Street Name...",
    authPasswordLabel: "Password",
    authRememberMe: "Remember me",
    authLoginBtn: "Login",
    authSignupBtn: "Create account",
    authSigningIn: "Signing In...",
    authRegistering: "Registering...",
    authToastWelcomeBack: "Welcome back",
    authToastConsumerCreated: "✅ Account created successfully!",
    authToastPartnerPending: "⏳ Account created! Pending admin approval before your offers go public.",
    authToastSuspended: "🚨 Your account has been suspended.",
    authErrEmailInvalid: "Please enter a valid email address.",
    authErrPasswordWeak: "Password must be at least 8 characters with uppercase, lowercase, and a number.",
    authErrSecretInvalid: "Invalid secret code for business signup.",
    authErrBusinessTypeInvalid: "Invalid business type selected.",
    authErrInvalidCreds: "Invalid email or password. Please try again.",
    authErrTooManyAttempts: "Too many attempts. Please wait a moment and try again.",
    authErrEmailInUse: "This email is already registered. Please login instead.",
    authErrWeakPassword: "Password is too weak. Please choose a stronger password.",
    authErrLoginGeneric: "Login failed",
    authErrSignupGeneric: "Signup failed",
    authErrFarmerBlocked: "Farmer accounts are managed in VitaChain and cannot sign in to SecondServe.",

    // Footer
    footerTagline: "Together, let's fight food waste. Save delicious meals at discounted prices in Casablanca and Mohammedia.",
    footerQuickLinks: "Quick Links",
    footerTodaysOffers: "Today's Offers",
    footerHowItWorks: "How it works",
    footerBecomePartner: "Become a partner",
    footerExplorePartners: "Explore Partners",
    footerContact: "Contact",
    footerLocationMorocco: "Casablanca, Morocco",
    footerPrivacyPolicy: "Privacy Policy",
    footerTerms: "Terms of Service",
    footerPrivacyToast: "Privacy policy is securely managed according to Morocco data protection standards.",
    footerTermsToast: "Terms of Service are bound by SecondServe marketplace standard agreements.",
    footerEmailCopiedToast: "✉️ Email copied to clipboard! Opening mail client...",
    footerCopyright: "All rights reserved.",

    // City selector modal
    citySelectorTitle: "Where are you?",
    citySelectorDesc: "Choose your city to discover anti-waste offers around you.",
    citySelectorComingSoon: "Other cities coming soon!",

    // Location permission modal extras
    locModalConsumerB1Title: "Filter Fresh Sweets Near You:",
    locModalConsumerB1Desc: "Auto-detects and highlights pastry shops & supermarkets inside your Casablanca or Mohammedia neighborhood.",
    locModalConsumerB2Title: "Distance & Directions Display:",
    locModalConsumerB2Desc: "Shows exact interactive distances and routes directly to the pickup storefront.",
    locModalConsumerB3Title: "Instant Street Auto-fill:",
    locModalConsumerB3Desc: "Uses secure premium reverse lookup maps to fill in your street profile automatically.",
    locModalPartnerB1Title: "Attract Local Customers:",
    locModalPartnerB1Desc: "Drops an accurate pin of your pastry shop/supermarket on the neighborhood search grid.",
    locModalPartnerB2Title: "Friction-free Pickups:",
    locModalPartnerB2Desc: "Customers see exact, verified lat-long coordinates on Google Maps to find and navigate to you.",
    locModalPartnerB3Title: "Store Profile Widget Sync:",
    locModalPartnerB3Desc: "Automatically generates and updates your embedded maps layout without coding error.",
    locModalInsecureTitle: "Insecure Connection Warning (HTTP)",
    locModalInsecureDesc: "Browsers only allow precise Geolocation on secure contexts (HTTPS or localhost). If location fails or is blocked, please manually enter your latitude and longitude coordinates.",
    locModalSecureNote: "🔒 Safe Context Certified: Your physical location is processed strictly in-browser and is never shared unless you click save of your profile.",
    locModalCloseAria: "Close dialog",

    // Dashboard labels
    labelFullName: "Full Name",
    labelEmail: "Email",
    labelCity: "City",
    labelPhoneNumber: "Phone Number",
    labelStreetAddress: "Street Address",
    labelLatitude: "Latitude Coordinates",
    labelLongitude: "Longitude Coordinates",
    labelBusinessName: "Business Name",
    labelBusinessTypeStrict: "Business Type (Strict Categories)",
    labelPhone: "Phone",
    labelMealName: "Meal / Bag Name",
    labelMealCategory: "Meal Category",
    labelDescription: "Description",
    labelOriginalPriceMAD: "Original Price (MAD)",
    labelDiscountedPriceMAD: "Discounted Price (MAD)",
    labelAvailableQuantity: "Available Quantity",
    labelCollectionDeadline: "Collection Deadline",
    labelImageUpload: "Image Upload",
    labelPartnerLocationStrict: "Partner Location (Strictly Editable)",
    labelInteractiveLocation: "Interactive User Location & Pin Adjuster",

    // Confirm modals
    confirmYes: "Yes",
    confirmSaveChangesTitle: "Save Changes",
    confirmSaveProfileMsg: "Are you sure you want to save changes to your profile?",
    confirmUpdateProductTitle: "Update Product",
    confirmPublishProductTitle: "Publish Product",
    confirmUpdateProductMsg: "Are you sure you want to update this product?",
    confirmPublishProductMsg: "Are you sure you want to publish this product?",

    // Pickup receipt + flow
    receiptPageTitle: "Pickup Receipt",
    receiptPickupCodeLabel: "Your Pickup Code",
    receiptShowCodeNote: "Show this code to the partner when you collect your order.",
    receiptOrderRef: "Order reference",
    receiptPlacedAt: "Placed",
    receiptPickupBy: "Pickup before",
    receiptExpired: "This pickup window has expired.",
    receiptStatusBadgeActive: "Awaiting Pickup",
    receiptStatusBadgeCompleted: "Picked Up",
    receiptStatusBadgeCancelled: "Cancelled",
    receiptItemsSection: "Items",
    receiptPartnerSection: "Pickup Location",
    receiptTotalLabel: "Total to pay in cash",
    receiptCallPartner: "Call partner",
    receiptViewMap: "View directions",
    receiptCancelBtn: "Cancel order",
    receiptBackToDashboard: "Back to my orders",
    receiptNotFound: "Order not found.",
    receiptNotAuthorized: "You don't have access to this order.",
    viewReceiptBtn: "View pickup receipt",
    pickupCodeTitle: "Confirm Pickup",
    pickupCodeEnterPrompt: "Ask the customer for their 4-digit pickup code and enter it below.",
    pickupCodePlaceholder: "1234",
    pickupCodeConfirmBtn: "Confirm pickup & collect cash",
    pickupCodeInvalid: "Incorrect code. Please double-check with the customer.",
    pickupCodeCancelBtn: "Cancel",
    orderExpiredBadge: "Expired",
    orderExpiredHint: "Pickup window passed. Cancel to restore stock.",
    countdownExpiresIn: "Expires in",
    countdownExpired: "Expired",
    cancelOrderConfirmMsg: "Are you sure you want to cancel this order? Stock will be returned to the partner.",

    // Navbar notifications dropdown
    realtimeOrdersHeading: "Real-time Orders",
    clearAllNotifBtn: "Clear All",
    notificationsClearedToast: "Notifications cleared",

    // AppContext toasts
    suspendedAccountToast: "🚨 Your account has been suspended.",
    farmerBlockedToast: "🚜 Farmer accounts are managed in VitaChain, not SecondServe.",
    loginToFavoriteToast: "Please login to save favorites",
    loginToOrderToast: "Please login to place an order",
    qtyNotAvailableToast: "Requested quantity not available",
    offerGoneToast: "This offer no longer exists.",
    placeOrderGenericErrToast: "Could not place the order. Please try again.",
    cancelOrderErrToast: "Could not cancel order.",
    orderCancelledToast: "Order cancelled",
    paymentAlreadyConfirmedToast: "Payment already confirmed.",
    notCodOrderToast: "This order is not a cash-on-delivery order.",
    confirmPaymentGenericErrToast: "Could not confirm payment. Please try again.",
    cashConfirmedToast: "Cash payment confirmed!",
    paymentReleasedToast: "💳 Payment of {amount} MAD released to Partner!",
    updateOrderErrToast: "Could not update order.",
    orderMarkedAsToast: "Order marked as {status}",
    reviewSubmitErrToast: "Could not submit review.",
    reviewSubmittedToast: "Review submitted!",
    notificationsClearedBangToast: "Notifications cleared!",
    banUserErrToast: "Could not ban user.",
    userBannedToast: "User banned.",
    unbanUserErrToast: "Could not unban user.",
    userUnbannedToast: "User unbanned.",
    deleteUserErrToast: "Could not delete user.",
    userDeletedToast: "User deleted.",
    approvePartnerErrToast: "Could not approve partner.",
    partnerApprovedToast: "Partner approved.",
    rejectPartnerErrToast: "Could not reject partner.",
    partnerRejectedToast: "Partner rejected.",
    addTicketErrToast: "Could not submit ticket.",
    ticketSubmittedToast: "Support ticket submitted!",
    resolveTicketErrToast: "Could not resolve ticket.",
    ticketResolvedToast: "Ticket resolved.",

    // OfferCard checkout validation
    errNameAndPhoneRequired: "❌ Please enter your Name and Phone Number",
    errInvalidCardNumber: "Invalid Card Number: Must contain 16 digits",
    errInvalidExpiry: "Invalid Expiration Format: Must be MM/YY",
    errInvalidCvv: "Invalid Security Code: Must contain 3 or 4 digits",
    paymentDeclinedToast: "❌ Payment Failed: Simulated Card decline verified.",
    paymentSuccessEscrowToast: "💳 Payment successful! Escrow activated.",
    cashOrderPlacedToast: "🎉 Cash order placed directly! Real-time dashboard updated.",
    transactionDeclinedError: "🚨 Transaction Declined: Insufficient funds or invalid card signature. (Simulated decline)",

    // Consumer Dashboard sidebar nav + support tab
    navMyOrders: "My Orders",
    navFavorites: "Favorites",
    navHelpSupport: "Help & Support",
    navSettings: "Settings",
    fillAllFieldsToast: "Please fill all fields",
    submitSupportRequestBtn: "Submit Support Request",
    subjectLabel: "Subject",
    subjectPlaceholder: "e.g., Order coordinates incorrect",
    descriptionLabel: "Description",
    descriptionPlaceholder: "Provide clear details to facilitate resolution...",
    submitTicketBtn: "Submit Ticket",
    ticketHistoryHeading: "Your Ticket History",
    noTicketsMsg: "No active or past support tickets.",
    ticketResolvedBadge: "Resolved",
    ticketPendingBadge: "Pending",
    adminSolutionLabel: "Admin Solution:",

    // Restaurant Dashboard extras
    offersNotVisibleYet: "Your offers are not visible to customers yet",
    pendingApprovalReason: "Your account is pending admin approval.",
    setCommerceTypeReason: "Set your commerce type in the Business Profile tab.",
    openBusinessProfileBtn: "Open Business Profile",
    viewFullDetailsBtn: "View full details",
    businessHelpSupportHeading: "Business Help & Support",
    subjectPlaceholderBiz: "e.g., GPS coordinates calibration offset",
    descriptionPlaceholderBiz: "Provide clear info to expedite validation...",
    ticketHistoryHeadingBiz: "Ticket History",
    noTicketsMsgBiz: "No support requests registered yet.",
  },
  ar: {
    appName: "سيكوند سيرف",
    meals: "الوجبات والعروض",
    login: "تسجيل الدخول",
    signup: "إنشاء حساب",
    myProfile: "ملفي الشخصي",
    logout: "تسجيل الخروج",
    logoutConfirmTitle: "تأكيد تسجيل الخروج",
    logoutConfirmMsg: "هل أنت متأكد من رغبتك في تسجيل الخروج من جلستك الحالية؟",
    confirm: "تأكيد",
    cancel: "إلغاء",
    filterByCity: "اختر المدينة",
    allCities: "جميع المدن",
    casablanca: "الدار البيضاء",
    mohammedia: "المحمدية",
    searchPlaceholder: "ابحث عن الحلويات الطازجة الفائضة، الوجبات، البقالة...",
    noProductsFound: "لا توجد منتجات تناسب هذه الفلاتر. جرب مدينة أخرى أو غير كلمة البحث.",
    resetFilters: "إعادة ضبط الفلاتر",
    category: "فئة الوجبة",
    type: "نوع النشاط",
    categoryAll: "الكل",
    bakedGoods: "مخبوزات وحلويات",
    produce: "منتجات طازجة خضار وفواكه",
    preparedMeals: "وجبات جاهزة",
    patisserie: "مخبزة وحلويات (Patisserie)",
    superette: "سوبريت وبقالة (Superette)",
    buffet: "بوفيه مفتوح (Buffet à volonté)",
    supermarket: "سوبرماركت وبقالة",
    surpriseBox: "علب المفاجآت فقط",
    distanceKm: "كيلومتر مجاور",
    getDirections: "عرض موقع المحل",
    orderNow: "أطلب واحجز الآن",
    originalPrice: "السعر الأصلي",
    reducedPrice: "السعر المخفض",
    quantityLeft: "كمية متبقية",
    reviewsCount: "تقييمات",

    // Checkout Form
    checkoutDetails: "معلومات الزبون",
    fullNameLabel: "الاسم الكامل",
    fullNamePlaceholder: "مثلا: أمينة أمين",
    phoneLabel: "رقم الهاتف",
    phonePlaceholder: "مثلا: 06 12 34 56 78",
    optionalMsgLabel: "رسالة أو ملاحظة اختيارية للشريك الموفر",
    optionalMsgPlaceholder: "مثلا: سأحضر للاستلام حوالي الساعة 19:30، يرجى حفظها مبردة.",
    realtimeSyncNote: "مزامنة فورية في الوقت الحقيقي",
    realtimeSyncDesc: "تتم مطابقة إحداثياتك وإرسال تنبيه فوري ومباشر إلى شاشة الشريك بمجرد تأكيد طلبك.",
    continueBtn: "الانتقال لخيارات الدفع",
    checkoutStepTitle: "تفاصيل المشتري",
    checkoutStepOf: "الخطوة 1 من 3",

    // Settlement Choice
    settlementMethod: "طريقة السداد",
    selectSettlementDesc: "الرجاء اختيار طريقة دفع المبلغ الإجمالي البالغ",
    payOnlineTitle: "💳 ادفع بأمان عبر الإنترنت الآن",
    payOnlineDesc: "قم بالدفع فوراً باستخدام بطاقة تجريبية آمنة. تُحفظ الأموال بشكل آمن في الضمان ولا يتم تحريرها للشريك إلا بعد استلامك للوجبة!",
    escrowBadge: "ضمان آمن",
    payDeliveryTitle: "🤝 الدفع عند الاستلام / في المتجر",
    payDeliveryDesc: "احجز وجبتك فوراً دون دفع مسبق. وادفع نقداً أو بالبطاقة عند الاستلام في الموقع الفعلي للشريك.",
    backToDetails: "العودة للتفاصيل",

    // Credit Card Form
    cardInfo: "معلومات البطاقة البنكية",
    cardInfoDesc: "أدخل بيانات بطاقتك لتأكيد العملية وتأمين مبلغ",
    cardNumberLabel: "رقم البطاقة البنكية",
    cardExpiryLabel: "تاريخ انتهاء الصلاحية (شهر/سنة)",
    cardCvvLabel: "رمز الأمان (CVV)",
    bankName: "بوابة سيكوند سيرف للضمان والاستلام",
    simulateDeclineLabel: "محاكاة رفض البطاقة",
    simulateDeclineDesc: "قم بتفعيل هذا الخيار لاختبار رد فعل النظام في حالة فشل رصيد البطاقة.",
    declineStatus: "محاكاة: بطاقة مرفوضة",
    approvedStatus: "محاكاة: تفعيل ناجح",
    authorizePaymentBtn: "تأكيد الدفع والخصم التجريبي",
    processingMsgTitle: "تأمين المعاملة البنكية...",
    processingMsgDesc: "يتم الاتصال بخادم البنك وإلكترونيات الضمان لتسجيل المعاملة بأمان...",

    // Checkout Success
    orderPlacedSuccess: "تم إرسال وتأكيد الطلب بنجاح!",
    orderPlacedDesc: "تمت مزامنة تفاصيل طلبك وعرضها مباشرة لدى المتجر الشريك",
    escrowHoldTitle: "الأموال محجوزة في أمان الضمان (عملية ناجحة)",
    escrowHoldDesc: "منصتنا تحتفظ بالرصيد بأمان. سيتم تحويله للشريك تلقائياً فور تأكيد استلامك للطلب في المحل.",
    deliveryPaymentTitle: "تم اختيار الدفع عند الاستلام مباشرة",
    deliveryPaymentDesc: "لم يتم خصم أي رصيد. المرجو إعداد المبلغ نقداً أو بالبطاقة لدفعه للشريك مباشرة عند الاستلام.",
    pickupLocationTitle: "عنوان وموقع الاستلام الفعلي",
    openGpsDirections: "فتح اتجاهات الطريق عبر GPS",
    returnMarketplace: "العودة للمتجر والوجبات",

    // Notifications
    newOrderAlertTitle: "🚨 وصل طلب جديد فوراً! 🚨",
    newOrderAlertDesc: "تلقى متجرك طلباً جديداً! تحقق من معلومات المشتري، المنتج المطلوب وتفاصيل الدفع.",
    bellTooltip: "تنبيهات غير مقروءة",
    noNotifications: "لا توجد تنبيهات جديدة",
    orderPlacedBy: "تلقيت طلباً جديداً من",
    amountLabel: "الإجمالي:",
    paymentLabel: "نوع الدفع:",
    notifMethodOnline: "دفع آمن عبر الإنترنت (ضمان)",
    notifMethodCash: "الدفع النقدي عند الاستلام",

    // Consumer Dashboard
    consumerDashboardTitle: "حساب المشتري",
    myOrdersTab: "طلباتي وسجل مشترياتي",
    myFavoritesTab: "مفضلتي",
    profileSettingsTab: "الملف الشخصي والموقع الجغرافي",
    noOrdersYet: "لم تقم بأي طلبات بعد. جرب إنقاذ وجباتك الطازجة من المتاجر المفضلة الآن!",
    orderStatusActive: "قيد الانتظار والاستلام",
    orderStatusCompleted: "مكتمل ومستلم",
    orderStatusCancelled: "ملغي",
    cancelOrderBtn: "إلغاء الطلب",
    rateAndReviewTitle: "تقييم العلبة ومشاركة تجربتك",
    reviewCommentPlaceholder: "اكتب رأيك حول جودة المنتجات، الكمية، وحالة العلبة المفاجئة...",
    submitReviewBtn: "نشر التقييم والتعليق",
    orderDateLabel: "تاريخ الطلب",

    // Partner Dashboard
    partnerDashboardTitle: "لوحة تحكم الشريك والتاجر",
    myProductsTab: "وجباتي الفائضة النشطة",
    manageProductsHeader: "إدارة عروض الوجبات النشطة",
    customerOrdersTab: "طلبات الزبناء (مباشر فوراً)",
    partnerProfileTab: "موقع المتجر الجغرافي",
    partnerReviewsTab: "آراء وتقييمات العملاء",
    addProductBtn: "إضافة عرض وجبة فائضة",
    editProductBtn: "تعديل المعلومات",
    deleteProductBtn: "إلغاء وحذف العرض",
    confirmDeliveryBtn: "تأكيد الاستلام وتحرير الرصيد",
    cashPaymentNotice: "🤝 تم اختيار الدفع عند الاستلام. يرجى تحصيل المبلغ من الزبون مباشرة عند التسليم.",
    escrowNoticeReleased: "🟢 تم نقل الأموال وتحريرها بنجاح إلى حساب متجرك.",
    escrowNoticeHeld: "⏳ الأموال موقوفة في الضمان الآمن. سيتم تحويلها لمتجرك بمجرد النقر على \"تأكيد التسليم\".",
    customerMessageTitle: "ملاحظة الزبون المرفقة:",
    noReviewsYet: "المتجر لم يتلق أي تقييمات مكتوبة بعد. انشر عروضك المتميزة للحصول على آراء جيدة!",

    // Product Add/Edit Dialog
    productFormTitleAdd: "نشر عرض وجبة فائضة جديدة",
    productFormTitleEdit: "تعديل تفاصيل العرض النشط",
    inputTitle: "اسم العرض / عنوان علبة المفاجأة",
    inputDescription: "وصف مفصل للمكونات المحتملة للعلبة",
    inputImageUrl: "رابط صورة المنتجات المرفقة",
    timeLimitLabel: "أقصى موعد متاح للاستلام",
    preciseCoordinatesLabel: "إحداثيات المتجر الجغرافية GPS (مطلوب لعرض الخريطة بدقة)",
    autoDetectBtn: "تحديد موقعي بالتلقائي (GPS)",
    detectingBtn: "جاري المسح ورصد الإحداثيات...",
    saveChangesBtn: "حفظ ونشر العرض",

    // Partner Profile Settings
    businessSettingsTitle: "الملف الجغرافي وبيانات المتجر",
    businessNameLabel: "اسم المحل / العلامة التجارية",
    businessAddressLabel: "العنوان الفعلي للشارع والمتجر",
    contactMailLabel: "البريد الإلكتروني المهني",
    contactPhoneLabel: "رقم هاتف العمل للاتصال",
    coordinatesLabel: "إحداثيات موقع المتجر الجغرافية",
    saveProfileBtn: "تحديث معلومات المتجر وحفظ إحداثيات GPS",
    howWeUseLocation: "لماذا يحتاج سيكوند سيرف لموقعك الجغرافي:",
    gpsSafetySystem: "نظام الأمان الجغرافي GPS",
    enablePreciseLocation: "السماح بالوصول للموقع بدقة",
    noThanksManual: "لا شكراً، سأكتب يدوياً",
    grantAutoDetect: "السماح والالتقاط التلقائي لموقعي",

    // Home Page Additional
    homeHeroSub: "أنقذوا المعجنات والحلويات الفاخرة، الوجبات الساخنة الطازجة أو بقايا الخضار الطازجة قبل انتهاء اليوم. طعام لذيذ، خيار بيئي ذكي، وبتكلفة أرخص بـ 70% في المغرب.",
    homeHeroCTA: "اكتشفوا الوجبات المتاحة قرب موقعكم الآن",
    statsRescued: "+14,250",
    statsCo2: "35,620 كجم",
    statsActivePartners: "+240",
    statsRescuedLabel: "وجبة تم إنقاذها",
    statsCo2Label: "ثنائي أكسيد الكربون مخفض",
    statsPartnersLabel: "شريك موفر نشط",
    geolocationPermissionRequired: "مطلوب إذن الوصول للموقع الجغرافي. لإجراء حسابات قياس المسافات المتبقية (بالكيلومتر) إلى موقع المتجر الفعلي بدقة، يتطلب ترخيص الوصول لنظام الملاحة GPS.",
    geolocationPermissionDeclined: "الرجاء السماح بالوصول إلى موقعك الجغرافي في إعدادات متصفحك أو جهازك لحساب المسافة الفاصلة بدقة. 📍",
    geolocationPositionUnavailable: "الموقع الجغرافي غير متوفر حالياً. تعذر تحديد رصد إشارات الساتل أو موقع الشبكة المحلية. سيتم تعيين مركز الدار البيضاء (33.5731، -7.5898) كخطة بديلة تلقائية.",
    geolocationTimeout: "انتهت مهلة استجابة طلب الموقع الجغرافي. يرجى محاولة النقر لإعادة المحاولة ومزامنة إحداثياتك فورا.",
    geolocationUnsecureWarning: "تحذير: المنصة لا تعمل عبر اتصال آمن مشفر (HTTPS). قد تتعطل خدمات رصد الإحداثيات ما لم تشغل الموقع محلياً على localhost.",
    geolocationSuccess: "تمت مزامنة إحداثيات موقعك الجغرافي بنجاح! تم تحديث ترتيب وحساب مسافات المنتجات الفاصلة عنك في الوقت الحقيقي.",
    categoryOther: "أخرى",
    gpsAcquiringSignal: "جاري الرصد والمسح...",
    clearGpsMode: "إعادة تعيين وضع GPS لزيادة الخصوصية",
    autoDetectLocationBanner: "اعثر على الوجبات الأقرب لموقعك الفعلي 📍",
    autoDetectExplanation: "نحن نستخدم واجهة الكشف الجغرافي الذكي المدمجة بالمتصفح لحساب المسافة الدقيقة الفاصلة بينك وبين مخابز الدار البيضاء والمحمدية لضمان استلام طلبك ساخناً وقبل فوات الأوان.",

    // Auth page
    authWelcomeBack: "مرحباً بعودتك!",
    authJoinUs: "انضم إلينا",
    authLoginSub: "سجّل دخولك لحفظ الوجبات.",
    authSignupSub: "أنشئ حساباً وابدأ في محاربة هدر الطعام.",
    authTabLogin: "تسجيل الدخول",
    authTabSignup: "إنشاء حساب",
    authRoleConsumer: "مستهلك",
    authRoleBusiness: "تاجر",
    authFullName: "الاسم الكامل",
    authBusinessName: "اسم المتجر",
    authFullNamePh: "مثلا: أمين العلوي",
    authBusinessNamePh: "مثلا: مخبزتي",
    authBusinessType: "نوع النشاط التجاري",
    authEmailLabel: "البريد الإلكتروني",
    authEmailPh: "you@example.com",
    authPhoneLabel: "رقم الهاتف",
    authPhonePh: "06 00 00 00 00",
    authCityLabel: "المدينة",
    authSecretCode: "الرمز السري",
    authSecretCodePh: "أدخل الرمز السري للتاجر",
    authFullAddress: "العنوان الكامل",
    authFullAddressPh: "123 اسم الشارع...",
    authPasswordLabel: "كلمة المرور",
    authRememberMe: "تذكرني",
    authLoginBtn: "تسجيل الدخول",
    authSignupBtn: "إنشاء الحساب",
    authSigningIn: "جاري تسجيل الدخول...",
    authRegistering: "جاري التسجيل...",
    authToastWelcomeBack: "مرحباً بعودتك",
    authToastConsumerCreated: "✅ تم إنشاء الحساب بنجاح!",
    authToastPartnerPending: "⏳ تم إنشاء الحساب! بانتظار موافقة المسؤول قبل ظهور عروضك للعموم.",
    authToastSuspended: "🚨 تم تعليق حسابك.",
    authErrEmailInvalid: "المرجو إدخال بريد إلكتروني صالح.",
    authErrPasswordWeak: "يجب أن تتكون كلمة المرور من 8 أحرف على الأقل وتشمل حرفاً كبيراً وصغيراً ورقماً.",
    authErrSecretInvalid: "الرمز السري للتاجر غير صحيح.",
    authErrBusinessTypeInvalid: "نوع النشاط التجاري المختار غير صالح.",
    authErrInvalidCreds: "البريد الإلكتروني أو كلمة المرور غير صحيحة. حاول مجدداً.",
    authErrTooManyAttempts: "محاولات كثيرة جداً. الرجاء الانتظار قليلاً ثم المحاولة من جديد.",
    authErrEmailInUse: "هذا البريد الإلكتروني مسجل بالفعل. الرجاء تسجيل الدخول.",
    authErrWeakPassword: "كلمة المرور ضعيفة. الرجاء اختيار كلمة مرور أقوى.",
    authErrLoginGeneric: "فشل تسجيل الدخول",
    authErrSignupGeneric: "فشل إنشاء الحساب",
    authErrFarmerBlocked: "حسابات المزارعين تُدار في VitaChain ولا يمكنها تسجيل الدخول إلى SecondServe.",

    // Footer
    footerTagline: "معاً نحارب هدر الطعام. أنقذ وجبات لذيذة بأسعار مخفضة في الدار البيضاء والمحمدية.",
    footerQuickLinks: "روابط سريعة",
    footerTodaysOffers: "عروض اليوم",
    footerHowItWorks: "كيف يعمل",
    footerBecomePartner: "كن شريكاً",
    footerExplorePartners: "اكتشف الشركاء",
    footerContact: "تواصل معنا",
    footerLocationMorocco: "الدار البيضاء، المغرب",
    footerPrivacyPolicy: "سياسة الخصوصية",
    footerTerms: "شروط الاستخدام",
    footerPrivacyToast: "تتم إدارة سياسة الخصوصية وفقاً لمعايير حماية البيانات المغربية.",
    footerTermsToast: "شروط الخدمة محكومة باتفاقيات منصة سيكوند سيرف الرسمية.",
    footerEmailCopiedToast: "✉️ تم نسخ البريد الإلكتروني إلى الحافظة! يتم فتح تطبيق البريد...",
    footerCopyright: "جميع الحقوق محفوظة.",

    // City selector modal
    citySelectorTitle: "أين أنت؟",
    citySelectorDesc: "اختر مدينتك لاكتشاف عروض مكافحة الهدر القريبة منك.",
    citySelectorComingSoon: "مدن أخرى قريباً!",

    // Location permission modal extras
    locModalConsumerB1Title: "ابحث عن الحلويات الطازجة بجوارك:",
    locModalConsumerB1Desc: "تحديد تلقائي للمخابز والسوبر ماركت داخل حيّك في الدار البيضاء أو المحمدية.",
    locModalConsumerB2Title: "عرض المسافات والاتجاهات:",
    locModalConsumerB2Desc: "يعرض المسافات الدقيقة والمسارات المباشرة إلى نقطة الاستلام.",
    locModalConsumerB3Title: "تعبئة تلقائية لعنوان الشارع:",
    locModalConsumerB3Desc: "يستخدم خرائط بحث عكسي آمنة لتعبئة عنوان شارعك تلقائياً في ملفك.",
    locModalPartnerB1Title: "جذب الزبناء المحليين:",
    locModalPartnerB1Desc: "يضع علامة دقيقة لمخبزتك أو متجرك على شبكة البحث الجغرافية لحيّك.",
    locModalPartnerB2Title: "استلامات بدون عوائق:",
    locModalPartnerB2Desc: "يرى الزبناء إحداثيات دقيقة موثقة على خرائط غوغل للوصول إليك بسهولة.",
    locModalPartnerB3Title: "مزامنة ملف المتجر التلقائية:",
    locModalPartnerB3Desc: "يولّد ويحدّث تصميم الخريطة المضمن في ملفك دون أخطاء برمجية.",
    locModalInsecureTitle: "تحذير اتصال غير آمن (HTTP)",
    locModalInsecureDesc: "تسمح المتصفحات بتحديد الموقع الدقيق فقط في السياقات الآمنة (HTTPS أو localhost). في حال فشل التحديد، الرجاء إدخال خط العرض والطول يدوياً.",
    locModalSecureNote: "🔒 اتصال آمن مؤمَّن: تتم معالجة موقعك الجغرافي محلياً داخل المتصفح فقط ولا تتم مشاركته إلا عند حفظ ملفك.",
    locModalCloseAria: "إغلاق النافذة",

    // Dashboard labels
    labelFullName: "الاسم الكامل",
    labelEmail: "البريد الإلكتروني",
    labelCity: "المدينة",
    labelPhoneNumber: "رقم الهاتف",
    labelStreetAddress: "عنوان الشارع",
    labelLatitude: "إحداثيات خط العرض",
    labelLongitude: "إحداثيات خط الطول",
    labelBusinessName: "اسم المتجر",
    labelBusinessTypeStrict: "نوع النشاط التجاري (فئات صارمة)",
    labelPhone: "الهاتف",
    labelMealName: "اسم الوجبة / علبة المفاجأة",
    labelMealCategory: "فئة الوجبة",
    labelDescription: "الوصف",
    labelOriginalPriceMAD: "السعر الأصلي (درهم)",
    labelDiscountedPriceMAD: "السعر المخفض (درهم)",
    labelAvailableQuantity: "الكمية المتوفرة",
    labelCollectionDeadline: "آخر موعد للاستلام",
    labelImageUpload: "تحميل صورة",
    labelPartnerLocationStrict: "موقع الشريك (قابل للتعديل بدقة)",
    labelInteractiveLocation: "الموقع التفاعلي وضبط المؤشر",

    // Confirm modals
    confirmYes: "نعم",
    confirmSaveChangesTitle: "حفظ التعديلات",
    confirmSaveProfileMsg: "هل أنت متأكد من حفظ التعديلات على ملفك الشخصي؟",
    confirmUpdateProductTitle: "تحديث المنتج",
    confirmPublishProductTitle: "نشر المنتج",
    confirmUpdateProductMsg: "هل أنت متأكد من تحديث هذا المنتج؟",
    confirmPublishProductMsg: "هل أنت متأكد من نشر هذا المنتج؟",

    // Pickup receipt + flow
    receiptPageTitle: "إيصال الاستلام",
    receiptPickupCodeLabel: "رمز الاستلام الخاص بك",
    receiptShowCodeNote: "أظهر هذا الرمز للشريك عند استلام طلبك.",
    receiptOrderRef: "مرجع الطلب",
    receiptPlacedAt: "تم الطلب في",
    receiptPickupBy: "آخر موعد للاستلام",
    receiptExpired: "انتهت مدة الاستلام لهذا الطلب.",
    receiptStatusBadgeActive: "في انتظار الاستلام",
    receiptStatusBadgeCompleted: "تم الاستلام",
    receiptStatusBadgeCancelled: "ملغي",
    receiptItemsSection: "المنتجات",
    receiptPartnerSection: "موقع الاستلام",
    receiptTotalLabel: "المبلغ المستحق نقداً",
    receiptCallPartner: "اتصل بالشريك",
    receiptViewMap: "عرض الاتجاهات",
    receiptCancelBtn: "إلغاء الطلب",
    receiptBackToDashboard: "العودة إلى طلباتي",
    receiptNotFound: "الطلب غير موجود.",
    receiptNotAuthorized: "ليس لديك صلاحية الوصول إلى هذا الطلب.",
    viewReceiptBtn: "عرض إيصال الاستلام",
    pickupCodeTitle: "تأكيد الاستلام",
    pickupCodeEnterPrompt: "اطلب من الزبون رمز الاستلام المكون من 4 أرقام وأدخله هنا.",
    pickupCodePlaceholder: "1234",
    pickupCodeConfirmBtn: "تأكيد الاستلام وتحصيل النقد",
    pickupCodeInvalid: "الرمز غير صحيح. الرجاء التحقق مع الزبون.",
    pickupCodeCancelBtn: "إلغاء",
    orderExpiredBadge: "منتهي",
    orderExpiredHint: "انتهت مهلة الاستلام. ألغِ الطلب لاسترجاع الكمية.",
    countdownExpiresIn: "ينتهي خلال",
    countdownExpired: "منتهي",
    cancelOrderConfirmMsg: "هل أنت متأكد من إلغاء هذا الطلب؟ سيتم إرجاع الكمية إلى الشريك.",

    // Navbar notifications dropdown
    realtimeOrdersHeading: "التنبيهات المباشرة",
    clearAllNotifBtn: "حذف الكل",
    notificationsClearedToast: "تم مسح التنبيهات",

    // AppContext toasts
    suspendedAccountToast: "🚨 تم تعليق حسابك.",
    farmerBlockedToast: "🚜 حسابات المزارعين تُدار في VitaChain وليس في SecondServe.",
    loginToFavoriteToast: "الرجاء تسجيل الدخول لحفظ المفضلة",
    loginToOrderToast: "الرجاء تسجيل الدخول لإتمام الطلب",
    qtyNotAvailableToast: "الكمية المطلوبة غير متوفرة",
    offerGoneToast: "هذا العرض لم يعد متوفراً.",
    placeOrderGenericErrToast: "تعذر إتمام الطلب. الرجاء المحاولة مجدداً.",
    cancelOrderErrToast: "تعذر إلغاء الطلب.",
    orderCancelledToast: "تم إلغاء الطلب",
    paymentAlreadyConfirmedToast: "تم تأكيد الدفع مسبقاً.",
    notCodOrderToast: "هذا الطلب ليس من نوع الدفع عند الاستلام.",
    confirmPaymentGenericErrToast: "تعذر تأكيد الدفع. الرجاء المحاولة مجدداً.",
    cashConfirmedToast: "تم تأكيد الدفع النقدي!",
    paymentReleasedToast: "💳 تم تحويل مبلغ {amount} درهم إلى الشريك!",
    updateOrderErrToast: "تعذر تحديث الطلب.",
    orderMarkedAsToast: "تم تحديث حالة الطلب إلى {status}",
    reviewSubmitErrToast: "تعذر إرسال التقييم.",
    reviewSubmittedToast: "تم إرسال التقييم!",
    notificationsClearedBangToast: "تم مسح التنبيهات!",
    banUserErrToast: "تعذر حظر المستخدم.",
    userBannedToast: "تم حظر المستخدم.",
    unbanUserErrToast: "تعذر إلغاء حظر المستخدم.",
    userUnbannedToast: "تم إلغاء حظر المستخدم.",
    deleteUserErrToast: "تعذر حذف المستخدم.",
    userDeletedToast: "تم حذف المستخدم.",
    approvePartnerErrToast: "تعذر قبول الشريك.",
    partnerApprovedToast: "تم قبول الشريك.",
    rejectPartnerErrToast: "تعذر رفض الشريك.",
    partnerRejectedToast: "تم رفض الشريك.",
    addTicketErrToast: "تعذر إرسال التذكرة.",
    ticketSubmittedToast: "تم إرسال تذكرة الدعم!",
    resolveTicketErrToast: "تعذر حل التذكرة.",
    ticketResolvedToast: "تم حل التذكرة.",

    // OfferCard checkout validation
    errNameAndPhoneRequired: "❌ المرجو إدخال الاسم ورقم الهاتف",
    errInvalidCardNumber: "رقم بطاقة غير صالح: يجب أن يتكون من 16 رقماً",
    errInvalidExpiry: "تاريخ غير صالح: يجب أن يكون بصيغة شهر/سنة MM/YY",
    errInvalidCvv: "رمز حماية غير صالح: يجب أن يتكون من 3 أو 4 أرقام",
    paymentDeclinedToast: "❌ فشل الدفع: تم تفعيل محاكاة رفض البطاقة.",
    paymentSuccessEscrowToast: "💳 تم الدفع بنجاح وحجز الضمان!",
    cashOrderPlacedToast: "🎉 تم إرسال طلبك نقداً بنجاح! تم تنبيه البائع فورا.",
    transactionDeclinedError: "🚨 تم رفض المعاملة: رصيد غير كافٍ أو بطاقة مرفوضة. (محاكاة الرفض)",

    // Consumer Dashboard sidebar nav + support tab
    navMyOrders: "طلباتي النشطة",
    navFavorites: "المفضلة",
    navHelpSupport: "الدعم والمساعدة",
    navSettings: "حسابي وبياناتي",
    fillAllFieldsToast: "الرجاء ملء جميع الحقول",
    submitSupportRequestBtn: "إنشاء تذكرة دعم جديدة",
    subjectLabel: "الموضوع",
    subjectPlaceholder: "مثال: مشكلة في استلام الطلب",
    descriptionLabel: "شرح المشكلة بالتفصيل",
    descriptionPlaceholder: "يرجى تقديم تفاصيل واضحة لنتمكن من مساعدتك بحسم...",
    submitTicketBtn: "إرسال التذكرة للإدارة",
    ticketHistoryHeading: "تذاكرك الحالية",
    noTicketsMsg: "لا توجد تذاكر دعم مسجلة لديك.",
    ticketResolvedBadge: "محلولة",
    ticketPendingBadge: "معالجة جارية",
    adminSolutionLabel: "رد مسؤول النظام:",

    // Restaurant Dashboard extras
    offersNotVisibleYet: "عروضك غير مرئية للعملاء بعد",
    pendingApprovalReason: "حسابك بانتظار موافقة المشرف.",
    setCommerceTypeReason: "حدّد نوع النشاط التجاري في ملف العمل.",
    openBusinessProfileBtn: "فتح ملف العمل",
    viewFullDetailsBtn: "عرض التفاصيل الكاملة",
    businessHelpSupportHeading: "الدعم الفني والمساعدة للشركاء",
    subjectPlaceholderBiz: "مثال: خطأ في إحداثيات GPS المحل",
    descriptionPlaceholderBiz: "يرجى تقديم تفاصيل واضحة لنتمكن من مساعدتك بحسم...",
    ticketHistoryHeadingBiz: "تذاكر المتجر السابقة",
    noTicketsMsgBiz: "لا توجد تذاكر دعم مسجلة لديك.",
  },
  fr: {
    appName: "SecondServe",
    meals: "Repas & Offres",
    login: "Connexion",
    signup: "Inscription",
    myProfile: "Mon profil",
    logout: "Déconnexion",
    logoutConfirmTitle: "Confirmation de déconnexion",
    logoutConfirmMsg: "Êtes-vous sûr de vouloir vous déconnecter de votre session ?",
    confirm: "Confirmer",
    cancel: "Annuler",
    filterByCity: "Choisir une ville",
    allCities: "Toutes les villes",
    casablanca: "Casablanca",
    mohammedia: "Mohammedia",
    searchPlaceholder: "Recherchez des pâtisseries, repas ou produits frais en surplus...",
    noProductsFound: "Aucun produit ne correspond à ces filtres. Essayez une autre ville ou réinitialisez la recherche.",
    resetFilters: "Réinitialiser les filtres",
    category: "Catégorie de repas",
    type: "Type de commerce",
    categoryAll: "Tout",
    bakedGoods: "Pâtisseries & Boulangerie",
    produce: "Produits frais",
    preparedMeals: "Plats préparés",
    patisserie: "Pâtisserie",
    superette: "Supérette",
    buffet: "Buffet à volonté",
    supermarket: "Supermarché & Épicerie",
    surpriseBox: "Boîtes surprises uniquement",
    distanceKm: "km à proximité",
    getDirections: "Voir les infos du lieu",
    orderNow: "Commander / Réserver",
    originalPrice: "Prix d'origine",
    reducedPrice: "Prix réduit",
    quantityLeft: "restants",
    reviewsCount: "avis",

    // Checkout Form
    checkoutDetails: "Informations client",
    fullNameLabel: "Nom complet",
    fullNamePlaceholder: "ex. Jeanne Dupont",
    phoneLabel: "Numéro de téléphone",
    phonePlaceholder: "ex. 06 12 34 56 78",
    optionalMsgLabel: "Message ou note facultative pour le partenaire",
    optionalMsgPlaceholder: "ex. Je viendrai le récupérer vers 19h30, merci de le garder au frais.",
    realtimeSyncNote: "Synchronisation instantanée",
    realtimeSyncDesc: "Vos coordonnées sont transmises et votre commande alerte instantanément le tableau de bord du partenaire dès l'envoi.",
    continueBtn: "Continuer vers le paiement",
    checkoutStepTitle: "Détails du client",
    checkoutStepOf: "Étape 1 sur 3",

    // Settlement Choice
    settlementMethod: "Mode de règlement",
    selectSettlementDesc: "Choisissez comment vous souhaitez régler le montant total de",
    payOnlineTitle: "💳 Payer en ligne en toute sécurité",
    payOnlineDesc: "Autorisez instantanément le paiement avec une carte bancaire fictive protégée. Les fonds sont conservés en séquestre et ne sont versés au partenaire qu'après la remise de la commande !",
    escrowBadge: "Séquestre sécurisé",
    payDeliveryTitle: "🤝 Payer à la livraison / sur place",
    payDeliveryDesc: "Réservez l'article instantanément sans payer en ligne. Payez en espèces ou par carte au moment du retrait chez le partenaire.",
    backToDetails: "Retour aux détails",

    // Credit Card Form
    cardInfo: "Informations bancaires",
    cardInfoDesc: "Saisissez des informations valides pour autoriser le montant total de",
    cardNumberLabel: "Numéro de carte bancaire",
    cardExpiryLabel: "Date d'expiration (MM/AA)",
    cardCvvLabel: "Code de sécurité (CVV)",
    bankName: "Passerelle de confiance SecondServe",
    simulateDeclineLabel: "Simuler un refus de carte",
    simulateDeclineDesc: "Activez pour tester la réaction du système face à un refus bancaire.",
    declineStatus: "SIMULATION : REFUSÉ",
    approvedStatus: "SIMULATION : APPROUVÉ",
    authorizePaymentBtn: "Autoriser le paiement en ligne",
    processingMsgTitle: "Sécurisation de la transaction...",
    processingMsgDesc: "Communication avec le serveur bancaire et mise en séquestre des fonds...",

    // Checkout Success
    orderPlacedSuccess: "Commande passée avec succès !",
    orderPlacedDesc: "Les détails de votre achat ont été transmis en toute sécurité directement à",
    escrowHoldTitle: "Fonds conservés en séquestre (opération réussie)",
    escrowHoldDesc: "Notre plateforme conserve votre paiement. Il sera automatiquement versé au partenaire dès qu'il confirmera la remise en boutique.",
    deliveryPaymentTitle: "Paiement sur place enregistré",
    deliveryPaymentDesc: "Aucun débit n'a été effectué. Prévoyez des espèces ou votre carte pour régler directement sur place.",
    pickupLocationTitle: "Lieu de retrait",
    openGpsDirections: "Ouvrir l'itinéraire GPS",
    returnMarketplace: "Retour aux offres",

    // Notifications
    newOrderAlertTitle: "🚨 Nouvelle commande instantanée ! 🚨",
    newOrderAlertDesc: "Votre commerce a reçu une commande en temps réel ! Vérifiez les informations du client, le produit demandé et le mode de paiement.",
    bellTooltip: "Notifications non lues",
    noNotifications: "Aucune nouvelle notification",
    orderPlacedBy: "a reçu une commande de",
    amountLabel: "Total :",
    paymentLabel: "Méthode :",
    notifMethodOnline: "Payé en ligne (séquestre)",
    notifMethodCash: "Paiement à la livraison (espèces)",

    // Consumer Dashboard
    consumerDashboardTitle: "Tableau de bord consommateur",
    myOrdersTab: "Mes commandes & historique",
    myFavoritesTab: "Mes favoris",
    profileSettingsTab: "Profil & localisation",
    noOrdersYet: "Aucune commande passée pour l'instant. Découvrez des produits frais auprès de vendeurs locaux !",
    orderStatusActive: "En attente de retrait",
    orderStatusCompleted: "Terminée",
    orderStatusCancelled: "Annulée",
    cancelOrderBtn: "Annuler la commande",
    rateAndReviewTitle: "Notez et commentez votre boîte surprise",
    reviewCommentPlaceholder: "Votre avis sur la fraîcheur, le goût et la quantité de cette boîte...",
    submitReviewBtn: "Envoyer l'avis",
    orderDateLabel: "Passée le",

    // Partner Dashboard
    partnerDashboardTitle: "Espace du restaurateur & partenaire",
    myProductsTab: "Mes surplus",
    manageProductsHeader: "Gérer les offres de surplus actives",
    customerOrdersTab: "Commandes clients (temps réel)",
    partnerProfileTab: "Profil géographique de l'établissement",
    partnerReviewsTab: "Avis clients",
    addProductBtn: "Ajouter une offre de surplus",
    editProductBtn: "Modifier",
    deleteProductBtn: "Supprimer",
    confirmDeliveryBtn: "Confirmer la remise & débloquer les fonds",
    cashPaymentNotice: "🤝 Paiement sur place choisi. Encaissez le montant intégral au moment du retrait.",
    escrowNoticeReleased: "🟢 Les fonds ont été versés en toute sécurité sur le solde de votre établissement.",
    escrowNoticeHeld: "⏳ Fonds conservés en séquestre. Ils seront automatiquement versés dès que vous cliquerez sur « Confirmer la remise ».",
    customerMessageTitle: "Note facultative du client :",
    noReviewsYet: "Aucune note ou avis reçu pour l'instant. Publiez des offres pour recueillir des retours !",

    // Product Add/Edit Dialog
    productFormTitleAdd: "Publier une nouvelle offre de surplus",
    productFormTitleEdit: "Modifier l'offre surprise active",
    inputTitle: "Nom de l'offre / titre de la boîte surprise",
    inputDescription: "Description du contenu",
    inputImageUrl: "URL de l'image du produit",
    timeLimitLabel: "Heure limite de retrait",
    preciseCoordinatesLabel: "Coordonnées GPS de l'établissement (requises pour l'affichage sur la carte)",
    autoDetectBtn: "Détecter automatiquement la position GPS",
    detectingBtn: "Recherche GPS en cours...",
    saveChangesBtn: "Enregistrer l'offre",

    // Partner Profile Settings
    businessSettingsTitle: "Profil géographique du partenaire",
    businessNameLabel: "Nom du commerce / de l'établissement",
    businessAddressLabel: "Adresse physique de l'établissement",
    contactMailLabel: "Adresse e-mail de contact",
    contactPhoneLabel: "Numéro de téléphone professionnel",
    coordinatesLabel: "Coordonnées GPS de l'établissement",
    saveProfileBtn: "Mettre à jour le profil et enregistrer les coordonnées",
    howWeUseLocation: "Pourquoi SecondServe demande l'accès à votre position :",
    gpsSafetySystem: "Système de sécurité GPS",
    enablePreciseLocation: "Activer la localisation précise",
    noThanksManual: "Non merci, je saisis manuellement",
    grantAutoDetect: "Autoriser & détecter automatiquement",

    // Home Page Additional
    homeHeroSub: "Sauvez de délicieuses pâtisseries, plats préparés ou surplus d'épicerie avant la fin de la journée. Savoureux, écoresponsable, et jusqu'à 70% moins cher au Maroc.",
    homeHeroCTA: "Découvrir les surplus près de chez vous",
    statsRescued: "14 250+",
    statsCo2: "35 620 kg",
    statsActivePartners: "240+",
    statsRescuedLabel: "Repas sauvés",
    statsCo2Label: "Émissions de CO2 évitées",
    statsPartnersLabel: "Partenaires actifs",
    geolocationPermissionRequired: "L'autorisation de localisation du navigateur est requise. Elle est nécessaire pour calculer la distance réelle (en km) jusqu'aux commerces de Casablanca.",
    geolocationPermissionDeclined: "Merci d'autoriser l'accès à la localisation dans les réglages de votre navigateur ou appareil pour calculer la distance exacte. 📍",
    geolocationPositionUnavailable: "Position indisponible. Le GPS ou le réseau local n'a pas pu déterminer votre position. Le centre de Casablanca (33.5731, -7.5898) est utilisé par défaut.",
    geolocationTimeout: "La demande d'autorisation a expiré. Cliquez pour réessayer la synchronisation.",
    geolocationUnsecureWarning: "Attention : la plateforme ne fonctionne pas sur une connexion HTTPS sécurisée. Les API de géolocalisation peuvent échouer hors de localhost.",
    geolocationSuccess: "Coordonnées GPS synchronisées avec succès ! Les distances et le tri des produits ont été mis à jour instantanément.",
    categoryOther: "Autre",
    gpsAcquiringSignal: "Acquisition du signal GPS...",
    clearGpsMode: "Réinitialiser le mode GPS",
    autoDetectLocationBanner: "Trouvez des repas tout près de vous 📍",
    autoDetectExplanation: "Nous utilisons l'API de géolocalisation native de votre navigateur pour calculer instantanément les distances exactes jusqu'aux commerces de Casablanca et Mohammedia, afin que vous récupériez vos surplus avant qu'ils n'expirent.",

    // Auth page
    authWelcomeBack: "Content de vous revoir !",
    authJoinUs: "Rejoignez-nous",
    authLoginSub: "Connectez-vous pour sauver des repas.",
    authSignupSub: "Créez un compte pour lutter contre le gaspillage alimentaire.",
    authTabLogin: "Connexion",
    authTabSignup: "Inscription",
    authRoleConsumer: "Particulier",
    authRoleBusiness: "Professionnel",
    authFullName: "Nom complet",
    authBusinessName: "Nom de l'établissement",
    authFullNamePh: "Jean Dupont",
    authBusinessNamePh: "Mon restaurant",
    authBusinessType: "Type de commerce",
    authEmailLabel: "E-mail",
    authEmailPh: "vous@exemple.com",
    authPhoneLabel: "Numéro de téléphone",
    authPhonePh: "06 00 00 00 00",
    authCityLabel: "Ville",
    authSecretCode: "Code secret",
    authSecretCodePh: "Saisissez le code secret professionnel",
    authFullAddress: "Adresse complète",
    authFullAddressPh: "123 nom de la rue...",
    authPasswordLabel: "Mot de passe",
    authRememberMe: "Se souvenir de moi",
    authLoginBtn: "Connexion",
    authSignupBtn: "Créer un compte",
    authSigningIn: "Connexion en cours...",
    authRegistering: "Inscription en cours...",
    authToastWelcomeBack: "Content de vous revoir",
    authToastConsumerCreated: "✅ Compte créé avec succès !",
    authToastPartnerPending: "⏳ Compte créé ! En attente de validation par un administrateur avant la publication de vos offres.",
    authToastSuspended: "🚨 Votre compte a été suspendu.",
    authErrEmailInvalid: "Merci de saisir une adresse e-mail valide.",
    authErrPasswordWeak: "Le mot de passe doit contenir au moins 8 caractères, une majuscule, une minuscule et un chiffre.",
    authErrSecretInvalid: "Code secret invalide pour une inscription professionnelle.",
    authErrBusinessTypeInvalid: "Type de commerce sélectionné invalide.",
    authErrInvalidCreds: "E-mail ou mot de passe incorrect. Veuillez réessayer.",
    authErrTooManyAttempts: "Trop de tentatives. Merci de patienter un instant avant de réessayer.",
    authErrEmailInUse: "Cet e-mail est déjà utilisé. Connectez-vous plutôt.",
    authErrWeakPassword: "Mot de passe trop faible. Choisissez un mot de passe plus robuste.",
    authErrLoginGeneric: "Échec de la connexion",
    authErrSignupGeneric: "Échec de l'inscription",
    authErrFarmerBlocked: "Les comptes agriculteurs sont gérés dans VitaChain et ne peuvent pas se connecter à SecondServe.",

    // Footer
    footerTagline: "Ensemble, luttons contre le gaspillage alimentaire. Sauvez de délicieux repas à prix réduit à Casablanca et Mohammedia.",
    footerQuickLinks: "Liens rapides",
    footerTodaysOffers: "Offres du jour",
    footerHowItWorks: "Comment ça marche",
    footerBecomePartner: "Devenir partenaire",
    footerExplorePartners: "Découvrir les partenaires",
    footerContact: "Contact",
    footerLocationMorocco: "Casablanca, Maroc",
    footerPrivacyPolicy: "Politique de confidentialité",
    footerTerms: "Conditions d'utilisation",
    footerPrivacyToast: "La politique de confidentialité est gérée conformément aux normes marocaines de protection des données.",
    footerTermsToast: "Les conditions d'utilisation sont régies par les accords standard de la marketplace SecondServe.",
    footerEmailCopiedToast: "✉️ E-mail copié dans le presse-papiers ! Ouverture du client de messagerie...",
    footerCopyright: "Tous droits réservés.",

    // City selector modal
    citySelectorTitle: "Où êtes-vous ?",
    citySelectorDesc: "Choisissez votre ville pour découvrir les offres anti-gaspillage autour de vous.",
    citySelectorComingSoon: "D'autres villes arrivent bientôt !",

    // Location permission modal extras
    locModalConsumerB1Title: "Filtrez les douceurs fraîches près de vous :",
    locModalConsumerB1Desc: "Détecte et met en avant automatiquement les boulangeries et supermarchés de votre quartier à Casablanca ou Mohammedia.",
    locModalConsumerB2Title: "Affichage des distances et itinéraires :",
    locModalConsumerB2Desc: "Affiche les distances exactes et les itinéraires directs vers le point de retrait.",
    locModalConsumerB3Title: "Autocomplétion instantanée de l'adresse :",
    locModalConsumerB3Desc: "Utilise une recherche inversée sécurisée pour remplir automatiquement votre adresse.",
    locModalPartnerB1Title: "Attirez des clients locaux :",
    locModalPartnerB1Desc: "Place une épingle précise de votre commerce sur la grille de recherche du quartier.",
    locModalPartnerB2Title: "Retraits sans friction :",
    locModalPartnerB2Desc: "Les clients voient des coordonnées exactes et vérifiées sur Google Maps pour vous trouver facilement.",
    locModalPartnerB3Title: "Synchronisation du profil de l'établissement :",
    locModalPartnerB3Desc: "Génère et met à jour automatiquement votre carte intégrée sans erreur.",
    locModalInsecureTitle: "Avertissement de connexion non sécurisée (HTTP)",
    locModalInsecureDesc: "Les navigateurs n'autorisent la géolocalisation précise que sur des contextes sécurisés (HTTPS ou localhost). En cas d'échec, saisissez manuellement votre latitude et longitude.",
    locModalSecureNote: "🔒 Contexte sécurisé certifié : votre position est traitée uniquement dans votre navigateur et n'est jamais partagée sans votre confirmation.",
    locModalCloseAria: "Fermer la fenêtre",

    // Dashboard labels
    labelFullName: "Nom complet",
    labelEmail: "E-mail",
    labelCity: "Ville",
    labelPhoneNumber: "Numéro de téléphone",
    labelStreetAddress: "Adresse",
    labelLatitude: "Latitude",
    labelLongitude: "Longitude",
    labelBusinessName: "Nom de l'établissement",
    labelBusinessTypeStrict: "Type de commerce (catégories strictes)",
    labelPhone: "Téléphone",
    labelMealName: "Nom du repas / sac",
    labelMealCategory: "Catégorie de repas",
    labelDescription: "Description",
    labelOriginalPriceMAD: "Prix d'origine (MAD)",
    labelDiscountedPriceMAD: "Prix réduit (MAD)",
    labelAvailableQuantity: "Quantité disponible",
    labelCollectionDeadline: "Date limite de retrait",
    labelImageUpload: "Téléverser une image",
    labelPartnerLocationStrict: "Localisation du partenaire (modifiable)",
    labelInteractiveLocation: "Localisation interactive et ajustement du repère",

    // Confirm modals
    confirmYes: "Oui",
    confirmSaveChangesTitle: "Enregistrer les modifications",
    confirmSaveProfileMsg: "Voulez-vous vraiment enregistrer les modifications de votre profil ?",
    confirmUpdateProductTitle: "Mettre à jour le produit",
    confirmPublishProductTitle: "Publier le produit",
    confirmUpdateProductMsg: "Voulez-vous vraiment mettre à jour ce produit ?",
    confirmPublishProductMsg: "Voulez-vous vraiment publier ce produit ?",

    // Pickup receipt + flow
    receiptPageTitle: "Reçu de retrait",
    receiptPickupCodeLabel: "Votre code de retrait",
    receiptShowCodeNote: "Montrez ce code au partenaire lors du retrait de votre commande.",
    receiptOrderRef: "Référence de commande",
    receiptPlacedAt: "Passée le",
    receiptPickupBy: "À retirer avant",
    receiptExpired: "Ce créneau de retrait a expiré.",
    receiptStatusBadgeActive: "En attente de retrait",
    receiptStatusBadgeCompleted: "Retirée",
    receiptStatusBadgeCancelled: "Annulée",
    receiptItemsSection: "Articles",
    receiptPartnerSection: "Lieu de retrait",
    receiptTotalLabel: "Total à payer en espèces",
    receiptCallPartner: "Appeler le partenaire",
    receiptViewMap: "Voir l'itinéraire",
    receiptCancelBtn: "Annuler la commande",
    receiptBackToDashboard: "Retour à mes commandes",
    receiptNotFound: "Commande introuvable.",
    receiptNotAuthorized: "Vous n'avez pas accès à cette commande.",
    viewReceiptBtn: "Voir le reçu de retrait",
    pickupCodeTitle: "Confirmer le retrait",
    pickupCodeEnterPrompt: "Demandez au client son code de retrait à 4 chiffres et saisissez-le ci-dessous.",
    pickupCodePlaceholder: "1234",
    pickupCodeConfirmBtn: "Confirmer le retrait et encaisser",
    pickupCodeInvalid: "Code incorrect. Merci de vérifier avec le client.",
    pickupCodeCancelBtn: "Annuler",
    orderExpiredBadge: "Expirée",
    orderExpiredHint: "Le créneau de retrait est passé. Annulez pour restituer le stock.",
    countdownExpiresIn: "Expire dans",
    countdownExpired: "Expiré",
    cancelOrderConfirmMsg: "Voulez-vous vraiment annuler cette commande ? Le stock sera restitué au partenaire.",

    // Navbar notifications dropdown
    realtimeOrdersHeading: "Commandes en temps réel",
    clearAllNotifBtn: "Tout effacer",
    notificationsClearedToast: "Notifications effacées",

    // AppContext toasts
    suspendedAccountToast: "🚨 Votre compte a été suspendu.",
    farmerBlockedToast: "🚜 Les comptes agriculteurs sont gérés dans VitaChain, pas dans SecondServe.",
    loginToFavoriteToast: "Connectez-vous pour enregistrer des favoris",
    loginToOrderToast: "Connectez-vous pour passer une commande",
    qtyNotAvailableToast: "Quantité demandée non disponible",
    offerGoneToast: "Cette offre n'existe plus.",
    placeOrderGenericErrToast: "Impossible de passer la commande. Veuillez réessayer.",
    cancelOrderErrToast: "Impossible d'annuler la commande.",
    orderCancelledToast: "Commande annulée",
    paymentAlreadyConfirmedToast: "Paiement déjà confirmé.",
    notCodOrderToast: "Cette commande n'est pas un paiement à la livraison.",
    confirmPaymentGenericErrToast: "Impossible de confirmer le paiement. Veuillez réessayer.",
    cashConfirmedToast: "Paiement en espèces confirmé !",
    paymentReleasedToast: "💳 Paiement de {amount} MAD versé au partenaire !",
    updateOrderErrToast: "Impossible de mettre à jour la commande.",
    orderMarkedAsToast: "Commande marquée comme {status}",
    reviewSubmitErrToast: "Impossible d'envoyer l'avis.",
    reviewSubmittedToast: "Avis envoyé !",
    notificationsClearedBangToast: "Notifications effacées !",
    banUserErrToast: "Impossible de bannir l'utilisateur.",
    userBannedToast: "Utilisateur banni.",
    unbanUserErrToast: "Impossible de débannir l'utilisateur.",
    userUnbannedToast: "Utilisateur débanni.",
    deleteUserErrToast: "Impossible de supprimer l'utilisateur.",
    userDeletedToast: "Utilisateur supprimé.",
    approvePartnerErrToast: "Impossible d'approuver le partenaire.",
    partnerApprovedToast: "Partenaire approuvé.",
    rejectPartnerErrToast: "Impossible de rejeter le partenaire.",
    partnerRejectedToast: "Partenaire rejeté.",
    addTicketErrToast: "Impossible d'envoyer le ticket.",
    ticketSubmittedToast: "Ticket de support envoyé !",
    resolveTicketErrToast: "Impossible de résoudre le ticket.",
    ticketResolvedToast: "Ticket résolu.",

    // OfferCard checkout validation
    errNameAndPhoneRequired: "❌ Merci de saisir votre nom et votre numéro de téléphone",
    errInvalidCardNumber: "Numéro de carte invalide : doit contenir 16 chiffres",
    errInvalidExpiry: "Format de date invalide : doit être MM/AA",
    errInvalidCvv: "Code de sécurité invalide : doit contenir 3 ou 4 chiffres",
    paymentDeclinedToast: "❌ Échec du paiement : refus de carte simulé confirmé.",
    paymentSuccessEscrowToast: "💳 Paiement réussi ! Séquestre activé.",
    cashOrderPlacedToast: "🎉 Commande en espèces envoyée avec succès ! Le vendeur a été notifié immédiatement.",
    transactionDeclinedError: "🚨 Transaction refusée : fonds insuffisants ou signature de carte invalide. (Refus simulé)",

    // Consumer Dashboard sidebar nav + support tab
    navMyOrders: "Mes commandes",
    navFavorites: "Favoris",
    navHelpSupport: "Aide & Support",
    navSettings: "Paramètres",
    fillAllFieldsToast: "Merci de remplir tous les champs",
    submitSupportRequestBtn: "Envoyer une demande de support",
    subjectLabel: "Sujet",
    subjectPlaceholder: "ex. Coordonnées de commande incorrectes",
    descriptionLabel: "Description",
    descriptionPlaceholder: "Fournissez des détails clairs pour faciliter la résolution...",
    submitTicketBtn: "Envoyer le ticket",
    ticketHistoryHeading: "Historique de vos tickets",
    noTicketsMsg: "Aucun ticket de support actif ou passé.",
    ticketResolvedBadge: "Résolu",
    ticketPendingBadge: "En cours",
    adminSolutionLabel: "Réponse de l'administrateur :",

    // Restaurant Dashboard extras
    offersNotVisibleYet: "Vos offres ne sont pas encore visibles pour les clients",
    pendingApprovalReason: "Votre compte est en attente de validation par un administrateur.",
    setCommerceTypeReason: "Renseignez votre type de commerce dans l'onglet Profil de l'établissement.",
    openBusinessProfileBtn: "Ouvrir le profil de l'établissement",
    viewFullDetailsBtn: "Voir tous les détails",
    businessHelpSupportHeading: "Aide & Support professionnel",
    subjectPlaceholderBiz: "ex. Décalage de calibration des coordonnées GPS",
    descriptionPlaceholderBiz: "Fournissez des informations claires pour accélérer la validation...",
    ticketHistoryHeadingBiz: "Historique des tickets",
    noTicketsMsgBiz: "Aucune demande de support enregistrée pour l'instant.",
  }
};
