'use client';

import React, { forwardRef } from 'react';
import { Spinner } from '@/components/ui/spinner';
import {
  buttonClass,
  type ButtonSize as Size,
  type ButtonVariant as Variant,
} from '@/lib/ui/buttonClass';

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant | undefined;
  size?: Size | undefined;
  loading?: boolean | undefined;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    disabled,
    className,
    children,
    type = 'button',
    ...rest
  },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={buttonClass({ variant, size, className })}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
});
