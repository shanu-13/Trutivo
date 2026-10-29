'use client';

import { useEffect } from 'react';
import AOS from 'aos';
import 'aos/dist/aos.css';

export default function AosInit() {
  useEffect(() => {
    AOS.init({
      duration: 800,
      easing: 'ease-out-cubic',
      once: false,
      offset: 60,
      delay: 50,
      mirror: false,
    });

    const refreshTimer = setTimeout(() => {
      AOS.refresh();
    }, 100);

    return () => {
      clearTimeout(refreshTimer);
    };
  }, []);

  return null;
}
