import { createContext, useContext } from 'react'

/** Shared "intro finished" flag so the hero choreography waits for the preloader. */
export const IntroContext = createContext<boolean>(true)
export const useIntroDone = () => useContext(IntroContext)
