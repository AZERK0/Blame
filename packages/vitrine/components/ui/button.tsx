import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b3acf3] focus-visible:ring-offset-2 focus-visible:ring-offset-[#050712] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'bg-white text-[#080b16] shadow-[0_18px_60px_rgba(255,255,255,0.22)] hover:-translate-y-0.5 hover:bg-[#bdc3fd]',
        dark:
          'bg-[#111] text-white shadow-none hover:-translate-y-0.5 hover:bg-[#2a2a2a]',
        outline:
          'border border-white/14 bg-white/[0.06] text-white/90 backdrop-blur-md hover:-translate-y-0.5 hover:bg-white/[0.1]',
      },
      size: {
        default: 'min-h-12 px-5 py-3',
        sm: 'min-h-10 px-4 py-2',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants>) {
  return (
    <button
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }