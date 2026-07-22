import { createRouter, createWebHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('../views/HomeView.vue') },
    { path: '/import', component: () => import('../views/ImportView.vue') },
    { path: '/decks', component: () => import('../views/DecksView.vue') },
    { path: '/decks/:deckId', component: () => import('../views/DeckDetailView.vue') },
    { path: '/study', component: () => import('../views/StudyView.vue') },
    { path: '/history', component: () => import('../views/HistoryView.vue') },
    { path: '/settings', component: () => import('../views/SettingsView.vue') },
    { path: '/about', component: () => import('../views/AboutView.vue') },
  ],
})
