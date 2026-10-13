import { z } from 'zod';

// Punch time, timezone and late/early rules are deliberately NOT accepted from the client:
// the server clock and the outlet's configured rules are the only source of truth.
// employeeId is only honoured for owners/managers (see AttendanceService.resolveTargetEmployee).
export const checkInSchema = z.object({
  employeeId: z.string().uuid().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  // The employee confirmed "Clock in anyway?" on a holiday / closed day / weekly off
  confirmOffDay: z.boolean().optional(),
});

export const checkOutSchema = z.object({
  employeeId: z.string().uuid().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

// Manager/owner correction of a punch (e.g. entering the real time of a missed clock-out)
export const correctAttendanceSchema = z
  .object({
    checkInTime: z.string().datetime().transform((val) => new Date(val)).optional(),
    checkOutTime: z.string().datetime().transform((val) => new Date(val)).optional(),
    reason: z.string().trim().min(3, 'Please give a reason for the correction').max(300),
  })
  .refine((data) => data.checkInTime || data.checkOutTime, {
    message: 'Provide a corrected clock-in or clock-out time',
  });
