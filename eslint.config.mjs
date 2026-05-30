import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

const NO_HANDROLLED_MODAL = [
  'error',
  {
    selector: "JSXOpeningElement[name.name='dialog']",
    message: 'Use the shared <Dialog> primitive (src/components/ui/dialog.tsx) instead of a raw <dialog>.'
  },
  {
    selector: "JSXAttribute[name.name='role'][value.value='dialog']",
    message: 'Use the shared <Dialog> primitive instead of hand-rolling role="dialog".'
  },
  {
    selector: "JSXAttribute[name.name='aria-modal']",
    message: 'Use the shared <Dialog> primitive instead of hand-rolling aria-modal.'
  }
];

export default [
  ...coreWebVitals,
  ...typescript,
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': NO_HANDROLLED_MODAL
    }
  },
  {
    // The primitive is the one place allowed to use the native <dialog> element.
    files: ['src/components/ui/dialog.tsx'],
    rules: {
      'no-restricted-syntax': 'off'
    }
  },
  {
    files: ['src/__tests__/**/*.{ts,tsx}', 'src/**/*.test.{ts,tsx}', 'src/**/*.spec.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off'
    }
  }
];
