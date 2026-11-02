export function successResponse(
  data: unknown,
  status = 200,
): Response {
  return Response.json(
    {
      success: true,
      data,
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

export function errorResponse(
  message: string,
  status = 400,
): Response {
  return Response.json(
    {
      success: false,
      error: message,
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}