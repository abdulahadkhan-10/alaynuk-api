import { Request, Response, NextFunction } from 'express';
import { aiService } from './ai.service';
import { sendSuccess, sendError } from '../../utils/response';

export class AiController {
  queryAssistant = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { prompt } = req.body;
      if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
        return sendError(res, 'INVALID_INPUT', 'Please provide a valid prompt for AlaynAI.', 400);
      }


      const outletId = (req.headers['x-outlet-id'] as string) || req.outletId || (req.body.outletId as string);
      const businessId = req.businessId;

      const answer = await aiService.queryAssistant(prompt.trim(), outletId, businessId);

      return sendSuccess(res, { answer });
    } catch (error) {
      next(error);
    }
  };
}

export const aiController = new AiController();
