export function findFlightAssetBoundaryFindings(root:string,enabled:boolean,files:readonly string[],manifest:Record<string,{file?:string;src?:string}>,sourceRoot?:string):Promise<string[]>
