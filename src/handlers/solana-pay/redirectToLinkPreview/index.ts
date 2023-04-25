import { Request, Response } from "express";
import { encode } from "querystring";

import { SELF_URL } from "../../../constants";

export function makeRedirectToLinkPreview(methodName: string) {
  return async (req: Request, res: Response) => {
    let encoded = encode(Object(req.body));
    res.status(200).send({
      linkToSign: `${SELF_URL}/page/${methodName}?${encoded}`,
    });
  };
}
