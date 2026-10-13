// Login and Signup pages.
export const auth = {
  login: {
    title: 'Welcome back',
    subtitle: 'Log in to continue building',
    submit: 'Log in',
    noAccount: 'New to Yasa?',
    signupLink: 'Create an account',
    success: 'Welcome back, {name}!',
  },

  signup: {
    title: 'Create your account',
    subtitle: 'Start building apps and websites by chatting with AI',
    submit: 'Create account',
    haveAccount: 'Already have an account?',
    loginLink: 'Log in',
    success: 'Welcome to Yasa, {name}!',
    pendingPrompt: 'Your idea is saved. We will start building right after you sign up.',
    terms: 'Free to use. No card required.',
  },

  fields: {
    name: 'Name',
    namePlaceholder: 'Your name',
    email: 'Email',
    emailPlaceholder: 'you@example.com',
    password: 'Password',
    passwordPlaceholder: 'Your password',
    newPasswordPlaceholder: 'At least {min} characters',
    passwordHint: 'At least {min} characters',
    showPassword: 'Show password',
    hidePassword: 'Hide password',
  },

  validation: {
    nameRequired: 'Enter your name',
    nameTooLong: 'The name is too long (max {max} characters)',
    emailRequired: 'Enter your email',
    emailInvalid: 'Enter a valid email address',
    passwordRequired: 'Enter your password',
    passwordTooShort: 'The password must be at least {min} characters',
    passwordTooLong: 'The password is too long (max {max} characters)',
  },

  errors: {
    invalidCredentials: 'Wrong email or password.',
    emailTaken: 'An account with this email already exists. Try logging in.',
  },

  forgot: {
    link: 'Forgot password?',
    title: 'Resetting a password',
    note: 'Yasa does not send emails. Ask the administrator of this server to reset your password. They run this command:',
    after: 'They will get a temporary password. Log in with it and change it in Settings.',
  },
} as const;
