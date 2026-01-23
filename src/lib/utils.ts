import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { getAddress, isAddress } from "viem"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Validate an Ethereum address
 * @param address - The address to validate
 * @returns true if valid, false otherwise
 */
export function isValidEthereumAddress(address: string): boolean {
  try {
    if (!address || typeof address !== 'string') {
      return false
    }
    // Use viem's isAddress for validation
    return isAddress(address.trim())
  } catch {
    return false
  }
}

/**
 * Normalize an Ethereum address (checksum format)
 * @param address - The address to normalize
 * @returns Checksummed address or null if invalid
 */
export function normalizeEthereumAddress(address: string): string | null {
  try {
    if (!address || typeof address !== 'string') {
      return null
    }
    return getAddress(address.trim())
  } catch {
    return null
  }
}
