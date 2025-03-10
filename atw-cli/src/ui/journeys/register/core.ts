
import { type Event } from "../../../actions/register"
type State = {
    event: Event | null
    hasSucceeded: boolean | null
    isSubmitting: boolean
    error: string | null
    email: string | null
}

export const initialState: State = {
    event: null,
    hasSucceeded: null,
    isSubmitting: false,
    error: null,
    email: null
}

type Action = {
    type: 'SELECT_EVENT'
    event: Event
} | {
    type: 'SET_EMAIL'
    email: string
} | {
    type: 'HANDLE_API_RESULTS'
    results: {
        error?: string
        success?: boolean
    }
}

export const toDate = (date: number) => `${new Date(date).toLocaleDateString()} ${new Date(date).toLocaleTimeString()}`

export const reducer = (state: State, action: Action): State => {
    switch (action.type) {
        case 'SELECT_EVENT':
            return {
                ...state,
                event: action.event,
            }
        case 'SET_EMAIL':
            return {
                ...state,
                isSubmitting: true,
                email: action.email
            }
        case 'HANDLE_API_RESULTS':
            console.log({action})
            return {
                ...state,
                isSubmitting: false,
                hasSucceeded: action.results.success || false,
                error: action.results.error || null
            }
        default:
            return state
    }
}
