import { Request, Response } from 'express';
import * as dashboardAnalyticsService from '../services/dashboard-analytics.service';

// Summary metrics for the signed-in user's saved analyses. The user comes from
// the session only; no user id is read from the request.
export const getDashboardAnalytics = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized', error: { code: 'UNAUTHORIZED', details: null } });
    }

    const analytics = await dashboardAnalyticsService.getDashboardAnalytics(userId);
    res.json({ success: true, message: 'Dashboard analytics retrieved successfully', data: analytics });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve dashboard analytics',
      error: { code: 'SERVER_ERROR', details: null },
    });
  }
};
