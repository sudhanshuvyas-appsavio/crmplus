import { createContext } from 'react'

/** Field id -> message. A form wraps its fields in the provider and every `Field`,
 *  `PhoneField` and `LinkPicker` with a matching id shows its message, without the
 *  message being passed down field by field. */
export const FieldErrorsContext = createContext<Record<string, string> | undefined>(undefined)
export const FieldErrorsProvider = FieldErrorsContext.Provider
