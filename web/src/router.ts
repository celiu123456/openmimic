import { createRouter, createWebHistory } from 'vue-router';

/**
 * History mode: the server falls back to `index.html` for unknown paths, so
 * `/i/<token>` survives a hard refresh or a link pasted into a group chat.
 */
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'inviter', component: () => import('./views/InviterView.vue') },
    {
      path: '/i/:token',
      name: 'interview',
      component: () => import('./views/InterviewView.vue'),
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
});
